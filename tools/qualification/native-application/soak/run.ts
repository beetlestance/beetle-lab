/** Actual30-minute packaged stream. Manual qualification, never normal startup. */
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {UnixDockerTransport} from '../../../../agent/src/backends/docker/index.js';
import {automaticSession, readReadyPublic} from '../compose/public.js';
import {cleanup, controlBudget, agentState} from '../compose/evidence.js';
import {cleanupLiveVolumes} from '../live-volumes.js';
import {saveRevision, value} from '../public-api.js';
import {counts, runtime} from '../../resources/lifecycle/observations.js';
import {idle} from '../load/observe.js';
import {candidate} from '../load/candidate.js';
import {advanced} from './advanced.js';
import {longConfiguration} from './policy.js';
import {longWindow} from './window.js';
import {finalDrain} from './final.js';
const [bundlePath, output, context = 'default', extra] = process.argv.slice(2);
assert(bundlePath && output && isAbsolute(bundlePath) && isAbsolute(output) && !extra && /^v24\./.test(process.version));
const prepared = await candidate(bundlePath, context, 2048); let f = prepared.f;
await mkdir(output, {mode: 0o700}); const owner = randomUUID();
await writeFile(join(output, 'owner.json'), JSON.stringify({root: f.root, project: f.project, revision: f.revision, owner}), {flag: 'wx', mode: 0o600});
let installation: string | undefined; let status = 'failed'; let phase = 'advanced-provision';
const results: Record<string, unknown> = {};
try {
 const installed = await advanced(f, owner); f = installed.f; installation = installed.installationId;
 await writeFile(join(output, 'installation-owner.json'), JSON.stringify({project: f.project, installationId: installation}), {flag: 'wx', mode: 0o600});
 await writeFile(join(output, 'advanced-policy-private.json'), JSON.stringify(installed.policy), {flag: 'wx', mode: 0o600});
 f.compose('up', '-d', '--no-build');
 const client = await automaticSession(f.origin, undefined, 8192);
 const settings = await readReadyPublic(signal => client.api.getInstallationSettings({signal})); assert.equal(settings.id, installation);
 assert.equal(agentState(f).installationId, installation); results.controlReserve = controlBudget(f);
 const peers = ['frontend', 'backend', 'agent'].map(role => {const id = f.compose('ps', '-q', role); assert(/^[a-f0-9]{64}$/.test(id));
  const row = f.docker.json<{HostConfig: {Memory: number}; State: {Running: boolean}}[]>(['inspect', id])[0]!;
  assert(row.State.Running); return {role, id, memory: row.HostConfig.Memory};});
 const endpoint = f.docker.run(['context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}']); assert(endpoint.startsWith('unix://'));
 const transport = new UnixDockerTransport(endpoint.slice(7));
 phase = 'idle'; results.idle = await idle(peers, transport, client.api, part => {results.idlePartial = part;});
 const subscribers = await Promise.all([0, 1, 2].map(() => automaticSession(f.origin, undefined, 8192)));
 const saved = await saveRevision(client.api, {offer: {config: await longConfiguration()}});
 const queued = value(await client.api.createRun({params: saved.params, body: {scope: saved.scope, requestId: randomUUID(),
  revisionId: saved.revision.id, engineProfile: 'k6-local', budget: settings.values.runDefaults.budget,
  executionPolicy: {mode: 'parallel', preferIdle: false}}}));
 phase = 'stream'; const observed = await longWindow({api: client.api, subscribers: subscribers.map(item => item.api), queued, peers, transport,
  checkpoint: part => {results.streamPartial = part;}, onActive: run => {results.execution = runtime(f, run, installation!);}}); results.stream = observed;
 assert(results.execution);
 phase = 'final-drain'; results.final = await finalDrain(client, observed.run);
 const target = counts(f); assert.deepEqual(target, {ready: 1, work: 1830, unexpected: 0}); results.targetRequests = target;
 phase = 'post-idle'; results.postIdle = await idle(peers, transport, client.api, part => {results.postIdlePartial = part;});
 status = 'passed';
} catch (error) {process.exitCode = 1; await writeFile(join(output, 'failure-private.txt'), String(error instanceof Error ? error.stack : error).slice(0, 16384), {flag: 'wx', mode: 0o600});}
finally {
 if (results.targetRequests === undefined) {try {results.targetRequests = counts(f);} catch {results.targetCountsUnavailable = true;}}
 let cleanupVerified = false;
 try {await cleanup(f, installation); if (installation) cleanupLiveVolumes({id: installation, user: '1000:1000', docker: f.docker}); f.docker.cleanup(owner); cleanupVerified = true;}
 catch {status = 'failed'; process.exitCode = 1;}
 await writeFile(join(output, 'outcome-private.json'), JSON.stringify({status, phase, cleanupVerified, sourceRevision: f.revision,
  architecture: f.architecture, harnessNode: process.version, environment: f.environment, imageIds: f.imageIds, results}, null, 2), {flag: 'wx', mode: 0o600});
 console.log(JSON.stringify({status, phase, cleanupVerified}));
}
