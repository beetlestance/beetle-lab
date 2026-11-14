/** Intact-journal active backend restart, then cold backup and isolated history. */
import { coldRecovery } from './recovery.js';
import assert from 'node:assert/strict';
import { stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { deriveInstalledIdentity } from '@beetle/contracts';
import { createK6ConfigSchema } from '@beetle/contracts/engine-config/k6';
import type { ApiClient, Run } from '@beetle/contracts/api';
import { Docker } from '../../../agent/test/container/docker.js';
import { fixture, digest } from '../../../agent/test/container/fixture.js';
import { openApplication } from '../../../app/src/bootstrap/api.js';
import type { Application } from '../../../app/src/bootstrap/api.js';
import { openBackendRecovery } from '../../../app/src/bootstrap/recovery-control/index.js';
import { argumentsFor, backendConfiguration } from './configuration.js';
import { provision, captureLogs, targetCounts } from './containers.js';
import { enqueue, finished, ownedOrigin, publicClient, value, waitForCapacity, pause } from './public-api.js';
import { inspectClosed } from './evidence.js';
import { cleanupLiveVolumes } from './live-volumes.js';
const args = argumentsFor(process.argv.slice(2)); assert.equal(args.status, 200);
for (const worker of [process.env.BEETLE_AGENT_WORKER_FILE ?? 'agent/dist/worker.js', process.env.BEETLE_METADATA_WORKER_FILE ?? 'app/dist/worker.js']) {
  const info = await stat(resolve(worker)); assert(info.isFile() && info.size > 0 && info.size <= 8388608, 'Build matching local workers before Docker effects');
}
const f = await fixture(new Docker(args.context, 2), args.agentImage, args.engineImage, 200);
f.offer.config.loadPlan = {version: 1, scenarios: [{id: 'main', name: 'restart', executor: 'per-vu-iterations',
  vus: 1, iterations: 10, maxDuration: '12s', startTime: '0s', gracefulStop: '0s'}], slos: []};
f.offer.config.selections = [{scenarioId: 'main', entries: [{requestId: 'get', weight: 1, wait: {durationMs: 500, jitterMs: 0}}]}];
f.offer.installedIdentity = deriveInstalledIdentity({manifest: f.manifest, profile: f.profile,
  identity: {manifestId: 'k6-native', profileId: 'native', catalogVersion: 1, schemaDigest: createK6ConfigSchema(digest).schemaDigest}}, digest);
const evidence: Record<string, unknown> = {status: 'running', architecture: f.architecture,
  agentImage: f.agentImage.Id, engineImage: f.engineImage.Id, nodeVersion: process.version, platform: process.platform,
  cleanupVerified: false, limits: {vus: 1, iterations: 10, maximumTargetRequests: 32},
  limitations: ['Graceful backend restart with intact agent/engine; no backend SIGKILL, lost PUT response, agent crash or release matrix claim. Restore checks run separately after terminal settlement.']};
console.log(JSON.stringify({status: 'started', directory: f.root}));
let app: Application | undefined; const started = Date.now();
async function active(api: ApiClient, run: Run): Promise<void> {
  const params = {organizationId: run.scope.organizationId, workspaceId: run.scope.workspaceId, runId: run.id};
  for (let calls = 0; calls < 80 && Date.now() - started < 60000; calls++) {
    const current = value(await api.getRun({params})); assert.equal(current.activeAttemptId, run.activeAttemptId);
    assert(!['finished', 'errored', 'cancelled'].includes(current.state), 'Need restart during actual execution');
    if (current.state === 'active') {
      const frame = await api.getRunLiveMetrics({params: {...params, attemptId: run.activeAttemptId}});
      if (frame.ok) {evidence.beforeRestart = current; evidence.liveSequence = frame.value.publishedSequence; return;}
    }
    await pause();
  }
  throw new Error('No bounded actual active-engine observation');
}
try {
  const origin = await ownedOrigin(); const privateOrigin = await provision(f, 32);
  const config = await backendConfiguration(f, privateOrigin, origin);
  app = await openApplication(config.application); await app.server.listen({...config.listen});
  const session = await publicClient(app, origin); await waitForCapacity(app);
  const queued = await enqueue(session.api, f); await active(session.api, queued);
  const gate = config.application.recoveryControl!;
  assert.throws(() => openBackendRecovery(gate.path, gate.installationId));
  await app.close(); app = undefined; openBackendRecovery(gate.path, gate.installationId).close();
  app = await openApplication(config.application); await app.server.listen({...config.listen});
  const next = await publicClient(app, origin); await waitForCapacity(app);
  const terminal = await finished(next.api, queued, 200); assert.equal(terminal.run.activeAttemptId, queued.activeAttemptId);
  evidence.run = terminal.run; evidence.sameOriginal = true;
  await app.close(); app = undefined; evidence.physical = await inspectClosed(f, terminal.run, terminal.result);
  evidence.targetCounts = targetCounts(f, {ready: 1, work: 10, unexpected: 0});
  evidence.recovery = await coldRecovery(f, terminal.run, args.context);
  evidence.targetCountsAfterHistory = targetCounts(f, {ready: 1, work: 10, unexpected: 0}); evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed';
  if (error instanceof AggregateError) evidence.failureCauses = error.errors.slice(0, 4).map((cause: unknown) => cause instanceof Error ? cause.message.slice(0, 256) : 'Unknown cause');
  evidence.failure = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 1024) : 'Unknown failure'; process.exitCode = 1;
} finally {
  if (app) {try {await app.close();} catch {evidence.status = 'failed'; process.exitCode = 1;}}
  try {evidence.diagnostics = await captureLogs(f);} catch {evidence.diagnostics = ['inventory'];}
  try {f.docker.cleanup(f.id); cleanupLiveVolumes(f); evidence.cleanupVerified = true;}
  catch {evidence.status = 'failed'; process.exitCode = 1;}
  evidence.elapsedMs = Date.now() - started;
  await writeFile(join(f.root, 'restart-evidence.json'), JSON.stringify(evidence, null, 2), {mode: 0o600});
  console.log(JSON.stringify({status: evidence.status, directory: f.root, cleanupVerified: evidence.cleanupVerified, failure: evidence.failure}));
}
