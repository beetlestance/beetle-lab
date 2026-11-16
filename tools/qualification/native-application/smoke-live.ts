/** Explicit synthetic public application -> agent -> native k6 live qualification. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createK6ConfigSchema } from '@beetle/contracts/engine-config/k6';
import { deriveInstalledIdentity, encodeCanonicalJson } from '@beetle/contracts';
import { captureLiveMetricSnapshot } from '@beetle/contracts/api';
import type { ApiClient, LiveMetricSnapshot, Run } from '@beetle/contracts/api';
import { Docker } from '../../../agent/test/container/docker.js';
import { fixture, digest } from '../../../agent/test/container/fixture.js';
import { openApplication } from '../../../app/src/bootstrap/api.js';
import type { Application } from '../../../app/src/bootstrap/api.js';
import { argumentsFor, backendConfiguration } from './configuration.js';
import { inspectClosed } from './evidence.js';
import { inspectCancelled } from './cancel-evidence.js';
import { provision, captureLogs, targetCounts } from './containers.js';
import { enqueue, ownedOrigin, publicClient, value, waitForCapacity, pause } from './public-api.js';
import { cleanupLiveVolumes } from './live-volumes.js';

const [agentImage, engineImage, mode = 'complete', context = 'default', extra] = process.argv.slice(2);
assert(agentImage && engineImage && !extra && ['complete', 'cancel'].includes(mode));
const args = argumentsFor([agentImage, engineImage, '200', context]);
const f = await fixture(new Docker(args.context, 2), args.agentImage, args.engineImage, 200);
assert.equal(f.profile.liveMetricMailbox, true, 'Exact image capability must enable mailbox profile');
const execution = f.manifest.phases.find(phase => phase.phase === 'execute')!; execution.timeoutMs = 20000;
f.offer.config.loadPlan = {version: 1, scenarios: [{id: 'live', name: 'bounded_native_live', executor: 'per-vu-iterations',
  vus: 1, iterations: 20, maxDuration: '15s', startTime: '0s', gracefulStop: '0s'}], slos: []};
f.offer.config.selections = [{scenarioId: 'live', entries: [{requestId: 'get', weight: 1, wait: {durationMs: 500, jitterMs: 0}}]}];
assert(createK6ConfigSchema(digest).validate(f.offer.config), 'Synthetic live config must validate before Docker effects');
f.offer.installedIdentity = deriveInstalledIdentity({manifest: f.manifest, profile: f.profile,
  identity: {manifestId: 'k6-native', profileId: 'native', catalogVersion: 1, schemaDigest: createK6ConfigSchema(digest).schemaDigest}}, digest);
const evidence: Record<string, unknown> = {status: 'running', mode, architecture: f.architecture,
  agentImage: f.agentImage.Id, engineImage: f.engineImage.Id, nodeVersion: process.version, platform: process.platform,
  cleanupVerified: false, limits: {vus: 1, iterations: 20, requestsPerTargetPath: 32, runTimeoutMs: 30000},
  limitations: ['No browser, Compose, amd64 or overhead qualification; current inventory cannot prove absence of delayed unknown daemon work.']};
await writeFile(join(f.root, 'live-owner.json'), JSON.stringify({installationId: f.id, root: f.root, user: f.user,
  agent: f.agent, target: f.target, network: f.network}), {mode: 0o600});
console.log(JSON.stringify({kind: 'qualification.started', directory: f.root, installationId: f.id}));
let app: Application | undefined; const started = Date.now();
interface Collected {frames: LiveMetricSnapshot[]; cancelled: boolean; unavailable: number}
function appendFrame(state: Collected, input: unknown): void {
  const frame = captureLiveMetricSnapshot(input, digest);
  assert(Buffer.byteLength(encodeCanonicalJson(frame, 65536)) <= 65536);
  const first = state.frames[0]; const previous = state.frames.at(-1);
  if (first) {assert.equal(frame.producerEpoch, first.producerEpoch); assert.equal(frame.subsetDigest, first.subsetDigest);}
  if (previous && frame.publishedSequence <= previous.publishedSequence) return;
  if (previous) {assert(frame.sourceSequence > previous.sourceSequence); assert(frame.startTimeMs >= previous.endTimeMs);}
  if (state.frames.length < 4) state.frames.push(frame);
}
async function sample(api: ApiClient, queued: Run, run: Run, state: Collected): Promise<void> {
  const params = {organizationId: queued.scope.organizationId, workspaceId: queued.scope.workspaceId, runId: queued.id};
  const response = await api.getRunLiveMetrics({params: {...params, attemptId: run.activeAttemptId}});
  if (!response.ok) {
    assert([429, 503].includes(response.error.status ?? 0) || ['transport', 'timeout'].includes(response.error.kind));
    state.unavailable++; return;
  }
  appendFrame(state, response.value);
  if (mode === 'cancel' && state.frames.length >= 2) {
    value(await api.cancelRun({params, body: {scope: queued.scope, requestId: randomUUID()}})); state.cancelled = true;
  }
}
async function terminal(api: ApiClient, run: Run, state: Collected) {
  const params = {organizationId: run.scope.organizationId, workspaceId: run.scope.workspaceId, runId: run.id};
  assert(state.frames.length >= 2, 'Need two observed native publisher revisions');
  assert.equal(run.state, mode === 'cancel' ? 'cancelled' : 'finished');
  const result = value(await api.getRunResult({params}));
  if (mode === 'complete') {assert(result.result); assert.equal(result.result.outcome, 'passed');}
  else {
    assert.equal(state.cancelled, true); assert.equal(run.outcome, 'inconclusive');
    assert.equal(result.result, null, 'This cancellation proof qualifies the unsealed-result path only');
  }
  const after = await api.getRunLiveMetrics({params: {...params, attemptId: run.activeAttemptId}});
  assert(!after.ok && after.error.status === 503);
  return {run, result, ...state};
}
async function observe(api: ApiClient, queued: Run) {
  const params = {organizationId: queued.scope.organizationId, workspaceId: queued.scope.workspaceId, runId: queued.id};
  const state: Collected = {frames: [], cancelled: false, unavailable: 0}; let lastLive = 0;
  for (let calls = 0; calls < 200 && Date.now() - started < 90000; calls++) {
    const run = value(await api.getRun({params}));
    if (['finished', 'cancelled', 'errored'].includes(run.state)) {
      evidence.terminalState = run.state; evidence.revisions = state.frames.map(frame => frame.publishedSequence);
      return terminal(api, run, state);
    }
    if (run.state === 'active' && Date.now() - lastLive >= 500 && !state.cancelled) {
      lastLive = Date.now(); await sample(api, queued, run, state);
    }
    await pause();
  }
  throw new Error('Bounded native live observation did not settle');
}

try {
  const origin = await ownedOrigin(); const privateOrigin = await provision(f, 32);
  const configuration = await backendConfiguration(f, privateOrigin, origin);
  app = await openApplication(configuration.application); await app.server.listen({...configuration.listen});
  const session = await publicClient(app, origin); await waitForCapacity(app);
  evidence.phase = 'enqueue'; const queued = await enqueue(session.api, f); evidence.phase = 'observe'; const observed = await observe(session.api, queued);
  Object.assign(evidence, observed); evidence.publicRequests = session.requestCount();
  await app.close(); app = undefined;
  evidence.physical = mode === 'complete' ? await inspectClosed(f, observed.run, observed.result) : inspectCancelled(f, observed.run, observed.result);
  if (mode === 'complete') evidence.targetCounts = targetCounts(f, {ready: 1, work: 20, unexpected: 0});
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed'; evidence.failure = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 1024) : 'Unknown qualification failure'; process.exitCode = 1;
} finally {
  if (app) {try {await app.close();} catch {evidence.applicationCloseFailure = true; evidence.status = 'failed'; process.exitCode = 1;}}
  try {evidence.diagnostics = await captureLogs(f);} catch {evidence.diagnostics = ['inventory'];}
  try {f.docker.cleanup(f.id); evidence.removedLiveVolumes = cleanupLiveVolumes(f); evidence.cleanupVerified = true;}
  catch {evidence.status = 'failed'; evidence.cleanupVerified = false; process.exitCode = 1;}
  evidence.elapsedMs = Date.now() - started;
  await writeFile(join(f.root, 'live-evidence.json'), JSON.stringify(evidence, null, 2), {mode: 0o600});
  console.log(JSON.stringify({status: evidence.status, directory: f.root, cleanupVerified: evidence.cleanupVerified, failure: evidence.failure}));
}
