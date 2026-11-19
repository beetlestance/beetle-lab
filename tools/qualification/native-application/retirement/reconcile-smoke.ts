/**
 * Manual qualification of the offline reconcile command (decision 030) on synthetic Docker data.
 * One real k6 run; with the agent stopped its task folder is renumbered; the cleanup the backend
 * then requests is refused without a plan; one-off agent containers preview and apply; the
 * restarted agent finishes cleanup. Only task-labelled resources; never a user installation.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Docker } from '../../../../agent/test/container/docker.js';
import { fixture, digest } from '../../../../agent/test/container/fixture.js';
import type { Fixture } from '../../../../agent/test/container/fixture.js';
import { namespaceCaps } from '../../../../agent/src/staging-namespace/index.js';
import { runtimeName } from '../../../../agent/src/backends/docker/index.js';
import { openApplication } from '../../../../app/src/bootstrap/api.js';
import { openAgentRuntime } from '../../../../app/src/bootstrap/agent-runtime.js';
import type { AgentRuntimeOptions } from '../../../../app/src/bootstrap/agent-runtime.js';
import { openMetadata } from '../../../../app/src/adapters/outbound/sqlite/index.js';
import type { Metadata, MetadataOptions } from '../../../../app/src/adapters/outbound/sqlite/index.js';
import type { OutputDeletionKey } from '../../../../app/src/ports/output-deletion-metadata.js';
import { prepareOutputDeletion } from '../../../../app/src/application/output-deletion/index.js';
import { argumentsFor, backendConfiguration } from '../configuration.js';
import { provision, captureLogs } from '../containers.js';
import { enqueue, finished, ownedOrigin, publicClient, waitForCapacity } from '../public-api.js';
import { inspectClosed } from '../evidence.js';
import { cleanupLiveVolumes } from '../live-volumes.js';
import { exactError } from './metadata.js';
import { driverOptions } from './driver.js';
import * as step from './reconcile-steps.js';

type Options = { readonly metadata: MetadataOptions; readonly agent: AgentRuntimeOptions };
const args = argumentsFor(process.argv.slice(2));
const f = await fixture(new Docker(args.context, 2), args.agentImage, args.engineImage, args.status);
const evidence: Record<string, unknown> = {
  status: 'running',
  phase: 'provision',
  cleanupVerified: false,
  architecture: f.architecture,
  platform: process.platform,
  nodeVersion: process.version,
  agentImage: f.agentImage.Id,
  engineImage: f.engineImage.Id,
  limits: [
    'Host backend, Linux agent on the local Docker; no release/amd64 claim from an arm64 run.',
    'The agent runs with the qualification user recipe; the socket-group-drop identity recipe is unit-tested.',
    'The renumber is a physical copy-and-rename, standing in for a Docker restart.',
  ],
};
let metadata: Metadata | undefined;
const started = Date.now();
console.log(JSON.stringify({ state: 'started', root: f.root }));

async function completedRun() {
  const origin = await provision(f);
  const external = await ownedOrigin();
  const configuration = await backendConfiguration(f, origin, external);
  assert(configuration.application.agent);
  evidence.phase = 'public-run';
  const app = await openApplication(configuration.application);
  try {
    await app.server.listen({ ...configuration.listen });
    const session = await publicClient(app, external);
    await waitForCapacity(app);
    const queued = await enqueue(session.api, f);
    evidence.phase = 'public-result';
    const terminal = await finished(session.api, queued, f.workStatus);
    return { configuration, queued, terminal };
  } finally {
    evidence.phase = `${String(evidence.phase)}:application-close`;
    // A background owner's failure surfaces only at close; its fixed reason names the owner.
    evidence.runtimeAtClose = app.runtimeState();
    await app.close();
  }
}
/** Runs the production backend Root against the agent until `done`, then closes it. */
async function drive(options: Options, origin: string, done: () => Promise<boolean>, ms: number, what: string) {
  const runtime = await openAgentRuntime(step.withOrigin(options.agent, origin), metadata!);
  try {
    await step.waitFor(done, ms, what);
    return runtime.state().status;
  } finally {
    await runtime.close();
  }
}
async function beginDeletion(scope: Parameters<Metadata['runs']['getRun']>[0]['scope'], id: string) {
  const run = await metadata!.runs.getRun({ scope, id });
  const command = prepareOutputDeletion(
    {
      kind: 'beginOutputDeletion',
      id: randomUUID(),
      requestedAt: new Date().toISOString(),
      request: { scope: run.scope, runId: run.id, requestId: randomUUID(), expectedRunVersion: run.version },
    },
    digest,
  );
  const intent = await metadata!.outputDeletions.begin(command);
  assert(intent.fileCount > 0);
  return { run, key: { id: intent.id, runId: intent.runId, scope: intent.scope } satisfies OutputDeletionKey };
}
function refusedJournal(attemptId: string) {
  const state = step.journalState(f, attemptId);
  assert.equal(state.intent, true, 'The retirement intent must be stored');
  assert.equal(state.plan || state.progress || state.receipt, false, 'Cleanup must stop before any plan');
  assert.equal(state.taskState, 'prepared');
  assert.equal(state.reconciliation, null);
  return state;
}
function operatorCommands(attemptId: string, anchor: string | null) {
  const usage = step.oneOff(f, ['reconcile', '--bogus']);
  assert.equal(usage.code, 2);
  const preview = step.oneOff(f, ['reconcile']);
  assert.equal(preview.code, 0);
  assert.deepEqual(preview.lines, [
    { attemptId, reconciled: false },
    { mode: 'preview', attempts: 1, refused: 0, stopped: false },
  ]);
  assert.equal(step.journalState(f, attemptId).reconciliation, null, 'Preview must not record anything');
  const apply = step.oneOff(f, ['reconcile', '--apply']);
  assert.equal(apply.code, 0, apply.logs);
  assert.deepEqual(apply.lines, [
    { attemptId, outcome: 'reconciled' },
    { mode: 'apply', attempts: 1, refused: 0, stopped: false },
  ]);
  const recorded = step.journalState(f, attemptId);
  assert.equal(recorded.anchor, anchor, 'The anchor is immutable');
  assert(recorded.reconciliation);
  assert.equal(recorded.plan, false);
  const replay = step.oneOff(f, ['reconcile', '--apply']);
  assert.equal(replay.code, 0, replay.logs);
  assert.deepEqual(replay.lines[0], { attemptId, outcome: 'current' });
  assert.equal(step.journalState(f, attemptId).reconciliation, recorded.reconciliation);
  return { usage, preview, apply, replay, reconciliation: JSON.parse(recorded.reconciliation) as unknown };
}
async function scenario(): Promise<void> {
  const { configuration, queued, terminal } = await completedRun();
  evidence.phase = 'physical-verification';
  const physical = await inspectClosed(f, terminal.run, terminal.result);
  f.offer = physical.offer;
  f.engine = runtimeName({ installationId: f.id, ...f.offer, generation: 1 });
  const options = driverOptions({
    metadata: configuration.application.metadata,
    agent: configuration.application.agent!,
  });
  evidence.phase = 'renumber';
  step.stopAgent(f);
  evidence.renumber = await step.renumberTaskFolder(f);
  let origin = await step.startAgent(f, false);
  evidence.phase = 'refused-cleanup';
  metadata = await openMetadata(options.metadata);
  const before = await metadata.inputs.storage();
  const { run, key } = await beginDeletion(terminal.run.scope, queued.id);
  const attemptId = run.activeAttemptId;
  const published = join(
    options.agent.dataRoot,
    'outputs',
    'published',
    run.scope.organizationId,
    run.scope.workspaceId,
    run.id,
    attemptId,
  );
  // Backend files go first; then give retirement several turns before the offline Journal check.
  let filesGoneAt = 0;
  const refusedTurns = async () => {
    if (!filesGoneAt && (await readdir(published)).length === 0) filesGoneAt = Date.now();
    return filesGoneAt > 0 && Date.now() - filesGoneAt > 15_000;
  };
  evidence.refusedRoot = await drive(options, origin, refusedTurns, 120_000, 'refused retirement turns');
  assert.notEqual((await metadata.outputDeletions.cleanupAck(key)).kind, 'stored');
  step.stopAgent(f);
  const refused = refusedJournal(attemptId);
  evidence.refusedJournal = { ...refused, anchor: undefined };
  evidence.phase = 'operator';
  evidence.operator = operatorCommands(attemptId, refused.anchor);
  evidence.phase = 'cleanup';
  origin = await step.startAgent(f, true);
  const cleaned = async () => (await metadata!.outputDeletions.cleanupAck(key)).kind === 'stored';
  evidence.cleanupRoot = await drive(options, origin, cleaned, 120_000, 'the cleaned ACK');
  await finalChecks(key, before, published);
  Object.assign(evidence, { status: 'passed', phase: 'finished', runId: run.id, attemptId, deletionId: key.id });
}
async function finalChecks(key: OutputDeletionKey, before: unknown, published: string) {
  const ack = await metadata!.outputDeletions.cleanupAck(key);
  assert(ack.kind === 'stored');
  assert.equal(ack.ack.reply.state, 'cleaned');
  assert.deepEqual(await metadata!.inputs.storage(), before);
  assert.deepEqual(await metadata!.outputDeletions.scanRetirements({ limit: 32 }), { items: [], nextCursor: null });
  assert.deepEqual(await readdir(published), []);
  assert.equal(f.docker.run(['ps', '-aq', '--no-trunc', '--filter', `label=dev.beetle.installation=${f.id}`]), '');
  assert.equal(f.docker.run(['volume', 'ls', '-q', '--filter', `label=dev.beetle.installation=${f.id}`]), '');
  assert.deepEqual(await readdir(join(f.root, 'staging')), [namespaceCaps.markerName]);
  evidence.ack = ack.ack;
}
async function release(fixtureState: Fixture): Promise<void> {
  if (metadata)
    await metadata.close().catch((error) => {
      evidence.metadataCloseFailure = exactError(error);
      evidence.status = 'failed';
      process.exitCode = 1;
    });
  try {
    evidence.diagnosticFailures = await captureLogs(fixtureState);
    fixtureState.docker.cleanup(fixtureState.id);
    evidence.removedMailboxVolumes = cleanupLiveVolumes(fixtureState);
    evidence.cleanupVerified = true;
  } catch (error) {
    evidence.cleanupFailure = exactError(error);
    evidence.status = 'failed';
    process.exitCode = 1;
  }
}
try {
  await scenario();
} catch (error) {
  evidence.status = 'failed';
  evidence.failure = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 2048) : 'Unknown failure';
  evidence.stack = error instanceof Error ? error.stack?.slice(0, 4096) : undefined;
  process.exitCode = 1;
} finally {
  await release(f);
  evidence.elapsedMs = Date.now() - started;
  await writeFile(join(f.root, 'reconcile-evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ status: evidence.status, root: f.root, phase: evidence.phase }));
}
