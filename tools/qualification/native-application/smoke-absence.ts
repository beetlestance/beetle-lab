/** Explicit manual native rejection qualification. Only the coordinator runs Docker. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Docker } from '../../../agent/test/container/docker.js';
import { fixture, digest } from '../../../agent/test/container/fixture.js';
import { openApplication } from '../../../app/src/bootstrap/api.js';
import type { Application } from '../../../app/src/bootstrap/api.js';
import { backendConfiguration } from './configuration.js';
import { provision, targetCounts, captureLogs } from './containers.js';
import { enqueue, ownedOrigin, publicClient, value, waitForCapacity } from './public-api.js';
import { initializationWorkerUrl } from './initialize.js';
import { absenceArguments, boundedFile, privateJson, rejectedFixture } from './absence-values.js';
import { finishedAbsence } from './absence-public.js';
import { inspectAbsence, inspectJournal } from './absence-evidence.js';
import { noEngineExecutions, stopAgent, verifyAgentAbsence } from './absence-native.js';

const args = absenceArguments(process.argv.slice(2));
const f = await fixture(new Docker(args.context, 2), args.agentImage, args.engineImage, 200);
const zero = { ready: 0, work: 0, unexpected: 0 };
const evidence: Record<string, unknown> = { status: 'running', phase: 'provision', transport: 'native TCP',
  architecture: f.architecture, agentImage: f.agentImage.Id, engineImage: f.engineImage.Id,
  daemonVersion: f.info.ServerVersion, nodeVersion: process.version, platform: process.platform,
  installedBudget: f.budget, manifestMinimum: f.manifest.minimumBudget, engineExecutions: null, cleanupVerified: false,
  limits: { publicRequestsPerSession: 256, terminalPolls: 180, terminalMs: 60000, eventRows: 128,
    proofBytes: 2048, fileBytes: 8388608, evidenceBytes: 131072, networks: 2 },
  limitations: ['No browser, Compose, concurrent load, crash during execution, abuse, soak or release qualification.',
    'Only the recorded native architecture is exercised; no native amd64 claim from an arm64 run.',
    'Current cleanup inventory cannot prove future absence after an unknown daemon create.'] };
let app: Application | undefined;
let applicationClosed = false;
const started = Date.now();
async function fingerprints(worker: URL) {
  const names = ['smoke-absence.ts', 'absence-values.ts', 'absence-values.test.ts', 'absence-bindings.ts', 'absence-bindings.test.ts', 'absence-public.ts',
    'absence-evidence.ts', 'absence-native.ts', 'configuration.ts', 'containers.ts', 'public-api.ts', 'initialize.ts', 'README.md'];
  const entries: [string, string][] = [];
  for (const name of names) entries.push([name, digest(await boundedFile(new URL(name, import.meta.url), 1048576))]);
  entries.push(['metadataWorker', digest(await boundedFile(worker, 8388608))]);
  entries.push(['agentInitializationWorker', digest(await boundedFile(initializationWorkerUrl(), 8388608))]);
  return Object.fromEntries(entries);
}
try {
  const agent = await provision(f); const origin = await ownedOrigin();
  // Build private backend settings before deriving the separate public request budget.
  const configuration = await backendConfiguration(f, agent, origin);
  const rejected = rejectedFixture(f); evidence.requestedBudget = rejected.budget;
  evidence.sourceDigests = await fingerprints(configuration.application.metadata.workerUrl);
  evidence.phase = 'application-startup'; app = await openApplication(configuration.application);
  await app.server.listen({ ...configuration.listen });
  const session = await publicClient(app, origin); await waitForCapacity(app);
  evidence.phase = 'public-enqueue'; const queued = await enqueue(session.api, rejected);
  evidence.phase = 'public-terminal'; const terminal = await finishedAbsence(session.api, queued);
  evidence.publicRequests = session.requestCount(); await privateJson(join(f.root, 'public-terminal.json'), terminal);
  await app.close(); app = undefined; applicationClosed = true;
  evidence.phase = 'physical-verification'; const physical = inspectAbsence(rejected, terminal.run);
  Object.assign(evidence, { proof: physical.proof, proofDigest: physical.proofDigest,
    receipt: physical.receipt, charge: physical.charge, allocation: physical.allocation });
  evidence.phase = 'agent-verification'; evidence.agent = verifyAgentAbsence(f, physical);
  evidence.engineExecutions = noEngineExecutions(f); evidence.targetCounts = targetCounts(f, zero);
  evidence.phase = 'metadata-reopen'; app = await openApplication(configuration.application); applicationClosed = false;
  await app.server.listen({ ...configuration.listen }); const reopened = await publicClient(app, origin);
  assert.deepEqual(value(await reopened.api.getRun({ params: terminal.params })), terminal.run);
  assert.deepEqual(value(await reopened.api.getRunResult({ params: terminal.params })), terminal.result);
  evidence.reopenPublicRequests = reopened.requestCount(); await app.close(); app = undefined; applicationClosed = true;
  assert.deepEqual(inspectAbsence(rejected, terminal.run), physical);
  assert.deepEqual(verifyAgentAbsence(f, physical), evidence.agent);
  evidence.phase = 'journal-verification'; stopAgent(f); evidence.journal = await inspectJournal(f, physical);
  evidence.engineExecutions = noEngineExecutions(f); evidence.reopenTargetCounts = targetCounts(f, zero);
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
  evidence.elapsedMs = Date.now() - started; await privateJson(join(f.root, 'evidence.json'), evidence);
  process.stdout.write(JSON.stringify({ status: evidence.status, evidenceDirectory: f.root,
    cleanupVerified: evidence.cleanupVerified, failure: evidence.failure }) + '\n');
}
