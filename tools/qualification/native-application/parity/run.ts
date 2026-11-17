import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {SuiteRevision} from '@beetle/contracts/api';
import {candidate} from '../load/candidate.js';
import {automaticClient} from '../compose/public.js';
import {cleanup, controlBudget, agentState} from '../compose/evidence.js';
import {cleanupLiveVolumes} from '../live-volumes.js';
import {saveRevision, value} from '../public-api.js';
import {runtime} from '../../resources/lifecycle/observations.js';
import {configuration, cases} from './config.js';
import {target, ordinaryCounts} from './target.js';
import {settled} from './result.js';
import {parityFailure} from './failure.js';
import {failureCounters} from './counters.js';
const [bundlePath, output, context = 'default', profile = 'executors', extra] = process.argv.slice(2);
assert(bundlePath && output && isAbsolute(bundlePath) && isAbsolute(output) && !extra && /^v24\./.test(process.version));
const kinds = cases(profile); const {f} = await candidate(bundlePath, context, 512);
await mkdir(output, {mode: 0o700});
await writeFile(join(output, 'owner.json'), JSON.stringify({root: f.root, project: f.project, revision: f.revision, owner: randomUUID()}), {flag: 'wx', mode: 0o600});
let installation: string | undefined; let status = 'failed'; let phase: string = 'startup'; const results: unknown[] = [];let failure: ReturnType<typeof parityFailure> | undefined;
try {
 const counts = await target(f); f.compose('up', '-d', '--no-build'); const client = await automaticClient(f.origin);
 installation = client.installation.id;
 await writeFile(join(output, 'installation-owner.json'), JSON.stringify({project: f.project, installationId: installation}), {flag: 'wx', mode: 0o600});
 assert.equal(agentState(f).installationId, installation); const reserve = controlBudget(f);
 let saved: Awaited<ReturnType<typeof saveRevision>> | undefined;
 for (const kind of kinds) {
  phase = kind; const config = await configuration(kind); let revision: SuiteRevision;
  if (!saved) {saved = await saveRevision(client.api, {offer: {config}}); revision = saved.revision;}
  else {
   const params = {...saved.params, suiteId: saved.revision.suiteId}; const suite = value(await client.api.getSuite({params}));
   revision = value(await client.api.createSuiteRevision({params, body: {scope: saved.scope, requestId: randomUUID(), expectedVersion: suite.version, engineId: 'k6', configVersion: 1, config}}));
  }
  const before = await counts();
  const queued = value(await client.api.createRun({params: saved.params, body: {scope: saved.scope, requestId: randomUUID(), revisionId: revision.id,
   engineProfile: 'k6-local', budget: client.installation.values.runDefaults.budget, executionPolicy: {mode: 'parallel', preferIdle: false}}}));
  const retained = {kind}; results.push(retained);
  const finished = await settled(client.api, queued, kind, evidence => {Object.assign(retained, evidence);}); const engine = runtime(f, finished.run, installation);
  assert.equal(engine.state.Running, false); assert.equal(engine.state.OOMKilled, false);
  const after = await counts(); assert.equal(after.ready - before.ready, 1); assert.equal(after.unexpected, 0);
  if (kind === 'executors') ordinaryCounts(after);
  else assert(after.work[kind]!.count - before.work[kind]!.count > 0, 'Native case must execute physical work');
  Object.assign(retained, {...finished, counts: after, controls: reserve, engine});
  if (kind === 'assertion' || kind === 'transport') Object.assign(retained, {nativeSummary: await failureCounters(client, finished.run, kind)});
 }
 status = 'passed';
} catch (error) {
 failure=parityFailure(error);process.exitCode = 1;
 await writeFile(join(output, 'failure-private.txt'), String(error instanceof Error ? error.stack : error).slice(0, 16384), {flag: 'wx', mode: 0o600});
} finally {
 let cleanupVerified = false;
 try {await cleanup(f, installation); if (installation) cleanupLiveVolumes({id: installation, user: '1000:1000', docker: f.docker}); cleanupVerified = true;}
 catch {status = 'failed'; process.exitCode = 1;}
 await writeFile(join(output, 'outcome-private.json'), JSON.stringify({status, phase, cleanupVerified, revision: f.revision, architecture: f.architecture,
  imageIds: f.imageIds, harnessNode: process.version, profile, results, failure}, null, 2), {flag: 'wx', mode: 0o600});
 console.log(JSON.stringify({status, phase, cleanupVerified}));
}
