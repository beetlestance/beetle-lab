import { observedHistory } from './history-summary.js';
/** Manual public application -> real agent -> real k6 qualification. Coordinator runs Docker. */
import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validate } from '@beetle/contracts';
import type { RunResultSnapshot } from '@beetle/contracts/api';
import { Docker, request } from '../../../agent/test/container/docker.js';
import type { Inspection } from '../../../agent/test/container/docker.js';
import { fixture, digest } from '../../../agent/test/container/fixture.js';
import { check } from '../../../agent/test/container/assertions.js';
import { runtimeName } from '../../../agent/src/backends/docker/index.js';
import { openApplication } from '../../../app/src/bootstrap/api.js';
import type { Application } from '../../../app/src/bootstrap/api.js';
import { argumentsFor, backendConfiguration } from './configuration.js';
import { provision, targetCounts, captureLogs } from './containers.js';
import { enqueue, finished, ownedOrigin, publicClient, value, waitForCapacity } from './public-api.js';
import { inspectClosed } from './evidence.js';
import { initializationWorkerUrl } from './initialize.js';

const args = argumentsFor(process.argv.slice(2));
const f = await fixture(new Docker(args.context, 2), args.agentImage, args.engineImage, args.status);
const evidence: Record<string, unknown> = { status: 'running', phase: 'provision', transport: 'native TCP',
  architecture: f.architecture, agentImage: f.agentImage.Id, engineImage: f.engineImage.Id,
  daemonVersion: f.info.ServerVersion, nodeVersion: process.version, platform: process.platform,
  workStatus: f.workStatus, requestedBudget: f.budget, engineExecutions: null, cleanupVerified: false,
  limitations: ['No crash/restart-during-execution, resource-abuse, Compose, browser or release qualification.',
    'Current cleanup inventory cannot prove future absence after an unknown daemon create.'] };
let app: Application | undefined;
let applicationClosed = false;
const started = Date.now();
async function fingerprints(worker: URL): Promise<Record<string, string>> {
  const files = ['configuration.ts', 'containers.ts', 'public-api.ts', 'evidence.ts', 'smoke-app.ts', 'initialize.ts', 'history-summary.ts'];
  const entries: [string, string][] = [];
  for (const name of files) entries.push([name, digest(await readFile(new URL(name, import.meta.url)))]);
  const workerStat = await stat(worker); assert(workerStat.isFile() && workerStat.size <= 8_388_608);
  entries.push(['metadataWorker', digest(await readFile(worker))]);
  const agentWorker = initializationWorkerUrl(); const agentStat = await stat(agentWorker);
  assert(agentStat.isFile() && agentStat.size <= 8_388_608);
  entries.push(['agentInitializationWorker', digest(await readFile(agentWorker))]); return Object.fromEntries(entries);
}
async function verifyNative(physical: Awaited<ReturnType<typeof inspectClosed>>, publicResult: RunResultSnapshot['result']) {
  const offer = physical.offer;
  // Only this persisted public enqueue original names the execution. Fixture's random Offer never triggers load.
  f.offer = offer; f.engine = runtimeName({ installationId: f.id, ...offer, generation: 1 });
  const response = request(f.docker, { agent: f.agent, credentialFile: f.tokenPath,
    path: `/runner/v1/attempts/${offer.attemptId}`, headers: { 'x-beetle-organization-id': offer.organizationId,
      'x-beetle-workspace-id': offer.workspaceId, 'x-beetle-generation': '1',
      'x-beetle-journal-authority': String(physical.receipt.journal_authority) } });
  assert.equal(response.status, 200);
  const snapshot = validate('AttemptSnapshot', JSON.parse(response.body) as unknown); assert(snapshot.ok);
  assert(publicResult); assert.deepEqual(snapshot.value.result, publicResult);
  f.docker.run(['stop', '-t', '10', f.agent]);
  assert.equal(f.docker.json<Inspection[]>(['inspect', f.agent])[0]!.State.ExitCode, 0);
  const engines = f.docker.run(['ps', '-aq', '--no-trunc', '--filter', `label=dev.beetle.installation=${f.id}`]).split('\n').filter(Boolean);
  assert.equal(engines.length, 1); assert.equal(f.docker.json<{ Name: string }[]>(['inspect', engines[0]!])[0]!.Name, `/${f.engine}`);
  return check(f, snapshot.value);
}
try {
  const agent = await provision(f); const origin = await ownedOrigin();
  const configuration = await backendConfiguration(f, agent, origin);
  evidence.sourceDigests = await fingerprints(configuration.application.metadata.workerUrl);
  evidence.phase = 'application-startup'; app = await openApplication(configuration.application);
  await app.server.listen({ ...configuration.listen });
  const session = await publicClient(app, origin); await waitForCapacity(app);
  evidence.phase = 'public-enqueue'; const queued = await enqueue(session.api, f);
  evidence.phase = 'public-terminal'; const terminal = await finished(session.api, queued, f.workStatus);
  evidence.phase = 'history-projection'; const running = app;
  const summary = await observedHistory(session.api, terminal.run, () => running.historySummaryState());
  evidence.historySummary = summary; evidence.publicRequests = session.requestCount();
  await writeFile(join(f.root, 'public-terminal.json'), JSON.stringify(terminal, null, 2), { mode: 0o600 });
  await app.close(); app = undefined; applicationClosed = true;
  evidence.phase = 'physical-verification'; const physical = await inspectClosed(f, terminal.run, terminal.result);
  assert.equal(summary.testDurationMs, physical.timing.nativeTestDurationMs);
  assert.equal(summary.testDurationMs, physical.timing.numericTestDurationMs);
  assert.equal(physical.timing.numericVersion, 4);
  Object.assign(evidence, { receipt: physical.receipt, charge: physical.charge,
    publishedArtifacts: physical.artifacts, durableAgentEvents: physical.eventCount });
  evidence.phase = 'metadata-reopen'; app = await openApplication(configuration.application); applicationClosed = false;
  await app.server.listen({ ...configuration.listen }); const reopened = await publicClient(app, origin);
  assert.deepEqual(value(await reopened.api.getRun({ params: terminal.params })), terminal.run);
  assert.deepEqual(value(await reopened.api.getRunResult({ params: terminal.params })), terminal.result);
  const restoredHistory = value(await reopened.api.listRuns({ params: { organizationId: terminal.run.scope.organizationId, workspaceId: terminal.run.scope.workspaceId }, query: { limit: 1 } }));
  assert.deepEqual(restoredHistory.summaries, [summary]);
  evidence.reopenPublicRequests = reopened.requestCount(); await app.close(); app = undefined; applicationClosed = true;
  assert.deepEqual(await inspectClosed(f, terminal.run, terminal.result), physical);
  evidence.targetCounts = targetCounts(f); Object.assign(evidence, await verifyNative(physical, terminal.result.result), { engineExecutions: 1 });
  evidence.status = 'passed'; evidence.phase = 'finished';
} catch (error) {
  evidence.status = 'failed'; evidence.failure = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 1024) : 'Unknown qualification failure';
  process.exitCode = 1;
} finally {
  if (app) {
    try { await app.close(); applicationClosed = true; }
    catch { evidence.applicationCloseFailure = true; evidence.status = 'failed'; process.exitCode = 1; }
  }
  evidence.applicationClosed = applicationClosed;
  try { evidence.diagnosticFailures = await captureLogs(f); }
  catch { evidence.diagnosticFailures = ['inventory']; }
  try { f.docker.cleanup(f.id); evidence.cleanupVerified = true; }
  catch { evidence.cleanupVerified = false; evidence.status = 'failed'; process.exitCode = 1; }
  evidence.elapsedMs = Date.now() - started;
  await writeFile(join(f.root, 'evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  process.stdout.write(JSON.stringify({ status: evidence.status, evidenceDirectory: f.root,
    cleanupVerified: evidence.cleanupVerified, failure: evidence.failure }) + '\n');
}
