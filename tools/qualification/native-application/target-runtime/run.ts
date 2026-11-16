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
import {target, targetCounts} from './target.js';
import {evidence} from './evidence.js';
const [bundle, output, context = 'default', extra] = process.argv.slice(2);
assert(bundle && output && isAbsolute(bundle) && isAbsolute(output) && !extra && /^v24\./.test(process.version));
const {f} = await candidate(bundle, context); await mkdir(output, {mode: 0o700});
await writeFile(join(output, 'owner.json'), JSON.stringify({root: f.root, project: f.project, revision: f.revision, owner: randomUUID()}), {flag: 'wx', mode: 0o600});
let installation: string | undefined; let status = 'failed'; let phase = 'startup'; const results: Record<string, unknown> = {};
try {
 await target(f); f.compose('up', '-d', '--no-build'); const client = await automaticClient(f.origin); installation = client.installation.id;
 await writeFile(join(output, 'installation-owner.json'), JSON.stringify({project: f.project, installationId: installation}), {flag: 'wx', mode: 0o600}); results.controlReserve = controlBudget(f);
 const saved = await saveRevision(client.api, {offer: {config: configuration()}}); phase = 'execution';
 const queued = value(await client.api.createRun({params: saved.params, body: {scope: saved.scope, requestId: randomUUID(), revisionId: saved.revision.id,
 engineProfile: 'k6-local', budget: client.installation.values.runDefaults.budget, executionPolicy: {mode: 'parallel', preferIdle: false}}}));
 results.queued = queued; const done = await finished(client.api, queued, 200); results.completed = done;
 const engine = runtime(f, done.run, installation); assert.equal(engine.state.Running, false); assert.equal(engine.state.OOMKilled, false); results.engine = engine;
 phase = 'artifact'; const observed = await evidence(client, done.run, value => {results.observedReport = value;}); results.targetRuntime = observed; const counts = targetCounts(f); results.target = counts;
 assert.equal(counts.ready, 1); assert.equal(counts.work, 40); assert.equal(counts.unexpected, 0); assert(Number.isSafeInteger(counts.runtime) && counts.runtime >= 6 && counts.runtime <= 32); assert.equal(counts.runtime, observed.samples);
 status = 'passed';
} catch (error) {process.exitCode = 1; await writeFile(join(output, 'failure-private.txt'), String(error instanceof Error ? error.stack : error).slice(0, 16384), {flag: 'wx', mode: 0o600});}
finally {
 let cleanupVerified = false;
 try {await cleanup(f, installation); if (installation) cleanupLiveVolumes({id: installation, user: '1000:1000', docker: f.docker}); cleanupVerified = true;}
 catch {status = 'failed'; process.exitCode = 1;}
 await writeFile(join(output, 'outcome-private.json'), JSON.stringify({status, phase, cleanupVerified, sourceRevision: f.revision, architecture: f.architecture,
 imageIds: f.imageIds, harnessNode: process.version, results}, null, 2), {flag: 'wx', mode: 0o600}); console.log(JSON.stringify({status, phase, cleanupVerified}));
}
