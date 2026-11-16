import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join, isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {candidate} from '../load/candidate.js';
import {automaticClient} from '../compose/public.js';
import {cleanup, controlBudget} from '../compose/evidence.js';
import {cleanupLiveVolumes} from '../live-volumes.js';
import {saveRevision, value, finished} from '../public-api.js';
import {runtime} from '../../resources/lifecycle/observations.js';
import {configuration} from './config.js';
import {secretTarget, bindSecrets, targetCounts} from './fixture.js';
import {audit, noCanary} from './audit.js';
import {wrongWorkspace} from './negative.js';
import {operatorReady} from './ready.js';
const [bundle, output, context = 'default', extra] = process.argv.slice(2);
assert(bundle && output && isAbsolute(bundle) && isAbsolute(output) && !extra && /^v24\./.test(process.version));
const {f} = await candidate(bundle, context); const owner = randomUUID(); await mkdir(output, {mode: 0o700});
await writeFile(join(output, 'owner.json'), JSON.stringify({root: f.root, project: f.project, revision: f.revision, owner}), {flag: 'wx', mode: 0o600});
let installation: string | undefined; let status = 'failed'; let phase = 'startup'; const results: Record<string, unknown> = {};
try {
 const canaries = await secretTarget(f); f.compose('up', '-d', '--no-build'); const client = await automaticClient(f.origin); installation = client.installation.id;
 await writeFile(join(output, 'installation-owner.json'), JSON.stringify({project: f.project, installationId: installation}), {flag: 'wx', mode: 0o600});
 results.controlReserve = controlBudget(f); results.perRunOutputBytes = 33554432; const saved = await saveRevision(client.api, {offer: {config: configuration()}});
 phase = 'operator-bindings'; results.operatorBindings = await bindSecrets(f, saved.params, canaries, owner); await operatorReady(f, client);
 phase = 'execution'; const queued = value(await client.api.createRun({params: saved.params, body: {scope: saved.scope, requestId: randomUUID(), revisionId: saved.revision.id,
 engineProfile: 'k6-local', budget: {...client.installation.values.runDefaults.budget, outputBytes: 33554432}, executionPolicy: {mode: 'parallel', preferIdle: false}}}));
 results.queued = queued; const done = await finished(client.api, queued, 200); results.completed = done;
 const engine = runtime(f, done.run, installation); assert.equal(engine.state.OOMKilled, false); assert.equal(engine.state.Running, false); results.engine = engine;
 noCanary(JSON.stringify(done), canaries); phase = 'artifact-audit'; results.audit = await audit(client, done.run, canaries);
 results.target = targetCounts(f); assert.deepEqual(results.target, {ready: 1, work: 3, rejected: 0});
 phase = 'cross-workspace'; const denied = await wrongWorkspace(client, f, saved.params.organizationId, canaries); results.crossWorkspace = denied;
 assert.deepEqual(targetCounts(f), {ready: 1, work: 3, rejected: 0});
 phase = 'rebound-workspace'; const rebound = await bindSecrets(f, denied.params, canaries, owner); assert.deepEqual(rebound, results.operatorBindings); await operatorReady(f, client);
 const retry = value(await client.api.createRun({params: denied.params, body: {scope: denied.scope, requestId: randomUUID(), revisionId: denied.revision.id,
 engineProfile: 'k6-local', budget: {...client.installation.values.runDefaults.budget, outputBytes: 33554432}, executionPolicy: {mode: 'parallel', preferIdle: false}}}));
 results.rebound = await finished(client.api, retry, 200); results.reboundEngine = runtime(f, retry, installation); assert.equal((results.reboundEngine as ReturnType<typeof runtime>).state.OOMKilled, false); noCanary(JSON.stringify(results.rebound), canaries); results.reboundAudit = await audit(client, retry, canaries);
 results.finalTarget = targetCounts(f); assert.deepEqual(results.finalTarget, {ready: 2, work: 6, rejected: 0});
 let auditedLogs = 0; let loggingDisabled = 0;
 for (const id of [...f.ids(), ...f.docker.ownedIds(installation)]) {
  const peers = f.docker.json<{HostConfig: {LogConfig: {Type: string}}}[]>(['inspect', id]); assert.equal(peers.length, 1);
  if (peers[0]!.HostConfig.LogConfig.Type === 'none') {loggingDisabled++; continue;}
  noCanary(f.logs(id), canaries); auditedLogs++;
 }
 results.logAudit = {auditedLogs, loggingDisabled};
 results.logsCanariesAbsent = true; status = 'passed';
} catch (error) {process.exitCode = 1; await writeFile(join(output, 'failure-private.txt'), String(error instanceof Error ? error.stack : error).slice(0, 16384), {flag: 'wx', mode: 0o600});}
finally {
 let cleanupVerified = false;
 try {await cleanup(f, installation); if (installation) cleanupLiveVolumes({id: installation, user: '1000:1000', docker: f.docker}); f.docker.cleanup(owner); cleanupVerified = true;}
 catch {status = 'failed'; process.exitCode = 1;}
 await writeFile(join(output, 'outcome-private.json'), JSON.stringify({status, phase, cleanupVerified, sourceRevision: f.revision, architecture: f.architecture,
 imageIds: f.imageIds, harnessNode: process.version, results}, null, 2), {flag: 'wx', mode: 0o600}); console.log(JSON.stringify({status, phase, cleanupVerified}));
}
