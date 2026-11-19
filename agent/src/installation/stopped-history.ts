import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { basename, dirname } from 'node:path';
import type { BigIntStats } from 'node:fs';
import { encodeLiveMetricHistory } from '@beetle/contracts/api';
import { encodeCanonicalJson } from '@beetle/contracts';
import type { PrivateSource } from '../output-source/index.js';
import { eligibleStoppedSource } from '../journal/stopped-history-value.js';
import type { Journal } from '../journal/index.js';
import type { AttemptSnapshot, Offer } from '@beetle/contracts';
import { readStoppedHistory } from '../collection/live-history/index.js';
import { nodePorts } from '../collection/output/index.js';
import type { OutputPorts } from '../collection/output/index.js';
import { snapshotRootIdentity } from '../collection/root/index.js';
import type { NativeDirectoryFact } from '../cleanup-control/index.js';
import type { Reservation } from '../admission/index.js';
import type { Operation } from '../backends/docker/index.js';
import type { LaunchInput } from '../supervisor/index.js';
import { captureTaskNamespaceState } from '../staging-namespace/index.js';
import type { StagingNamespaceJournal, TaskNamespaceIntent } from '../staging-namespace/index.js';
import { checkBudget } from './budget.js';
import { InstallationError } from './types.js';
import type { InstallationOptions, StoppedHistoryApproval } from './types.js';
import type { Entry } from './entry.js';
import { allocation, recover } from './recovery.js';
import { JournalError } from '../journal/options.js';
import type { StoppedObservation } from '../journal/stopped-history-value.js';

interface Request {
  readonly snapshot: AttemptSnapshot;
  readonly launch: LaunchInput;
  readonly reservation: Reservation;
  readonly offer: Offer;
  readonly namespaceIdentity: string;
  readonly approval: StoppedHistoryApproval;
  readonly tasks: Pick<StagingNamespaceJournal, 'readTask'>;
  readonly operation: Operation;
  readonly source?: PrivateSource;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

function stoppedSnapshot(snapshot: AttemptSnapshot): boolean {
  return (
    snapshot.admission?.state === 'released' &&
    snapshot.admission.disposition === 'settled' &&
    snapshot.state === 'exited' &&
    snapshot.exitEvidence !== undefined
  );
}

function stoppedExit(snapshot: AttemptSnapshot, reservation: Reservation, source?: PrivateSource): boolean {
  if (!stoppedSnapshot(snapshot)) return false;
  const { releaseEvidence: release, launchSettlement: settled } = reservation;
  return Boolean(
    release &&
    settled &&
    settled.disposition !== 'unknown' &&
    stoppedRelease(reservation, release, source) &&
    release.launch.settlementId === settled.evidenceId &&
    release.runtime.observedAt > settled.settledAt,
  );
}

function stoppedRelease(
  reservation: Reservation,
  release: NonNullable<Reservation['releaseEvidence']>,
  source: PrivateSource | undefined,
): boolean {
  if (reservation.status !== 'released' || reservation.aborted || !reservation.launchClosed) return false;
  if (release.authority !== 'supervisor' || release.runtime.state !== 'stopped' || !matchesLaunch(reservation, release))
    return false;
  if (!source) return release.collection.state === 'failed';
  return eligibleStoppedSource(source.manifest.result) && sameEvidence(source.release, release);
}

const sameEvidence = (a: unknown, b: unknown) => encodeCanonicalJson(a, 4096) === encodeCanonicalJson(b, 4096);
function matchesLaunch(reservation: Reservation, release: NonNullable<Reservation['releaseEvidence']>): boolean {
  return (
    release.runtimeId === reservation.runtimeId &&
    release.createToken === reservation.createToken &&
    release.launch.epoch === 1 &&
    typeof release.launch.startToken === 'string' &&
    release.launch.startToken === reservation.startToken
  );
}

function sameDirectory(expected: NativeDirectoryFact, stat: BigIntStats): boolean {
  return (
    stat.isDirectory() &&
    expected.dev === String(stat.dev) &&
    expected.ino === String(stat.ino) &&
    expected.uid === String(stat.uid) &&
    expected.gid === String(stat.gid) &&
    expected.mode === String(stat.mode)
  );
}

function stoppedScopeMatches(input: Request): boolean {
  const { key, plan } = input.launch;
  const release = input.reservation.releaseEvidence!;
  return (
    (['organizationId', 'workspaceId', 'attemptId', 'generation'] as const).every(
      (field) => release.key[field] === key[field] && input.snapshot[field] === key[field],
    ) &&
    input.offer.intentDigest === plan.spec.Labels['dev.beetle.intent'] &&
    release.specDigest === plan.specDigest
  );
}

async function captureRoot(input: Request, ports: OutputPorts) {
  const { plan, key } = input.launch;
  const path = preparedOutputPath(input.launch);
  if (!path) return undefined;
  const task = captureTaskNamespaceState(await input.tasks.readTask({ ...key, generation: 1 }));
  checkBudget(input.operation);
  if (task?.state !== 'prepared') return undefined;
  const { intent, anchor } = task;
  if (!matchesTask(input, intent, path)) return undefined;
  const parent = dirname(path);
  if ((await ports.realpath(path)) !== path) return undefined;
  checkBudget(input.operation);
  const taskStat = await ports.lstat(parent, { bigint: true });
  checkBudget(input.operation);
  const stat = await ports.lstat(path, { bigint: true });
  checkBudget(input.operation);
  if (!sameDirectory(anchor.directories.task, taskStat) || !sameDirectory(anchor.directories.output, stat))
    return undefined;
  const uid = Number(plan.spec.User.split(':')[0]);
  const root = snapshotRootIdentity(path, uid, stat);
  return !input.source || sameEvidence(root, input.source.root) ? root : undefined;
}
function preparedOutputPath({ key, plan }: LaunchInput): string | undefined {
  const mount = plan.spec.HostConfig.Mounts.find((value) => value.Target === '/beetle/output');
  if (mount?.Type === 'bind' && !mount.ReadOnly && key.generation === 1) return mount.Source;
  return undefined;
}

function matchesTask(input: Request, intent: TaskNamespaceIntent, path: string): boolean {
  const { key, plan } = input.launch;
  return (
    intent.namespaceIdentity === input.namespaceIdentity &&
    intent.purpose === 'performance' &&
    intent.specDigest === plan.specDigest &&
    intent.runtimeName === plan.name &&
    basename(dirname(path)) === plan.name &&
    basename(path) === 'output' &&
    intent.original.intentDigest === input.offer.intentDigest &&
    (['organizationId', 'workspaceId', 'attemptId', 'generation'] as const).every(
      (field) => intent.original[field] === key[field],
    )
  );
}

/** Called only after installation retirement settles the actual producer and read owners. */
export async function recoverStoppedObservation(
  input: Request,
  ports: OutputPorts = nodePorts,
): Promise<StoppedObservation | undefined> {
  if (!stoppedExit(input.snapshot, input.reservation, input.source) || !stoppedScopeMatches(input)) return undefined;
  const read = await openRecovery(input, ports);
  if (!read) return undefined;
  const result = await read.result;
  try {
    await read.close();
  } catch {
    throw new InstallationError('cleanup');
  }
  if (!result.ok) {
    if (result.reason === 'busy') throw new JournalError('queue_full');
    return undefined;
  }
  try {
    const json = new TextDecoder().decode(encodeLiveMetricHistory(result.value, hash, input.launch.key));
    return { json, digest: hash(json), bytes: Buffer.byteLength(json) };
  } catch {
    return undefined;
  }
}

async function openRecovery(input: Request, ports: OutputPorts) {
  try {
    checkBudget(input.operation);
    const approval = input.approval(input.offer, input.launch);
    if (!approval) return undefined;
    const root = await captureRoot(input, ports);
    if (!root) return undefined;
    const deadline = Math.min(input.operation.deadline, ports.now() + 30_000);
    return readStoppedHistory(
      {
        approval,
        root,
        maximumBytes: input.reservation.budget.outputBytes,
        deadline,
        ...(input.operation.signal ? { signal: input.operation.signal } : {}),
      },
      ports,
    );
  } catch (error) {
    if (error instanceof JournalError && error.code === 'queue_full') throw error;
    // Checkpoint evidence is optional. Closure can still preserve the existing result.
    return undefined;
  }
}

export async function prepareStoppedObservation(
  options: InstallationOptions,
  entry: Entry,
  snapshot: AttemptSnapshot,
  budget?: Operation,
  source?: PrivateSource,
): Promise<StoppedObservation | undefined> {
  const approval = options.stoppedHistoryApproval;
  if (!approval || snapshot.state !== 'exited') return undefined;
  const operation = budget ?? { deadline: performance.now() + 30_000 };
  let request: Request;
  try {
    const reservation = await allocation(options.journal, entry.key);
    if (!reservation) return undefined;
    const offer = await options.journal.readOffer(entry.key);
    const plan = entry.plan ?? recover(options.catalog, offer, reservation);
    request = {
      snapshot,
      ...(source ? { source } : {}),
      reservation,
      offer,
      approval,
      operation,
      launch: { key: entry.key, plan },
      namespaceIdentity: options.gate.namespaceIdentity,
      tasks: options.journal.stagingNamespace,
    };
  } catch (error) {
    if (error instanceof JournalError && error.code === 'queue_full') throw error;
    return undefined;
  }
  return recoverStoppedObservation(request);
}

const historyOwners = new WeakMap<Journal, Promise<void>>();

export async function withStoppedHistoryOwner<T>(
  journal: Journal,
  operation: Operation | undefined,
  work: () => Promise<T>,
): Promise<T> {
  const active = historyOwners.get(journal);
  if (active) {
    if (operation) throw new JournalError('queue_full');
    await active;
    return withStoppedHistoryOwner(journal, operation, work);
  }
  let release!: () => void;
  historyOwners.set(
    journal,
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  try {
    return await work();
  } finally {
    historyOwners.delete(journal);
    release();
  }
}
