import type { Offer } from '@beetle/contracts';
import { JournalError } from '../journal/index.js';
import type { AdmissionValue, Reservation } from '../admission/index.js';
import type { Operation, RuntimePlan } from '../backends/docker/index.js';
import { createAttemptController } from '../controller/index.js';
import { collectOutputs } from '../collection/output/index.js';
import { allocation, recover } from './recovery.js';
import { checkBudget } from './budget.js';
import { ensureOutputWatch } from './guard.js';
import { ensureTimeoutWatch } from './timeout.js';
import type { TimeoutReason } from '../timeout/index.js';
import type { Entry } from './entry.js';
import { InstallationError } from './types.js';
import type { DriveProgress, InstallationOptions } from './types.js';
import type { CollectionIntent } from '../output-source/index.js';
import { recoverSource } from './source-recovery.js';
import { recoverAbsence } from './absence.js';
export interface DriveContext {
  readonly options: InstallationOptions;
  now(): number;
  guard(entry: Entry, budget: Operation): void;
  acquireStage(): boolean;
  releaseStage(): void;
  retire(entry: Entry, progress: DriveProgress): Promise<void>;
  stopGuard(entry: Entry): Promise<void>;
  stopTimeout(entry: Entry, reason: TimeoutReason | 'artifact_incomplete'): Promise<void>;
}
const failed: DriveProgress = { kind: 'released', collection: 'failed' };
async function abort(context: DriveContext, entry: Entry): Promise<DriveProgress> {
  await context.options.journal.admission({ kind: 'abortUnstarted', key: entry.key });
  await context.retire(entry, failed); return failed;
}
function executionGuard(context: DriveContext, entry: Entry, budget: Operation): void {
  context.guard(entry, budget);
  if (entry.cancelled) throw new InstallationError('closed');
}
async function admit(context: DriveContext, entry: Entry, budget: Operation): Promise<Reservation | DriveProgress> {
  const { journal } = context.options;
  const cursors = await journal.sourceCursors(entry.key); executionGuard(context, entry, budget);
  const now = context.now(); executionGuard(context, entry, budget);
  const value = await journal.admission({ kind: 'admit', key: entry.key,
    sourceOrdinal: cursors.supervisorOrdinal + 1, now });
  // A successful original admission remains owned even if cancellation overtook it.
  if ('status' in value) { entry.fresh = true; return value; }
  if ('kind' in value && value.kind === 'reject') {
    const progress = { kind: 'rejected' as const, reason: value.reason };
    await context.retire(entry, progress); return progress;
  }
  executionGuard(context, entry, budget);
  return admissionProgress(value);
}
function admissionProgress(value: AdmissionValue): DriveProgress {
  if ('kind' in value && value.kind !== 'admit') {
    if (value.reason === 'cancelled') throw new InstallationError('closed');
    return { kind: value.kind === 'defer' ? 'deferred' : 'rejected', reason: value.reason };
  }
  throw new InstallationError('journal');
}
async function stage(context: DriveContext, entry: Entry, offer: Offer, current: Reservation,
  budget: Operation): Promise<RuntimePlan | DriveProgress> {
  if (entry.prepared) throw new InstallationError('cleanup');
  if (!context.acquireStage()) return { kind: 'deferred', reason: 'staging_busy' };
  try {
    executionGuard(context, entry, budget);
    let engine: ReturnType<InstallationOptions['catalog']['resolve']>;
    try { engine = context.options.catalog.resolve(offer, current.validation); }
    catch {
      const progress = { kind: 'rejected' as const, reason: 'installed_identity' };
      await context.retire(entry, progress); return progress;
    }
    const stager = context.options.stagerFor(engine); executionGuard(context, entry, budget);
    entry.prepared = true;
    const signal = budget.signal ? AbortSignal.any([budget.signal, entry.abort.signal]) : entry.abort.signal;
    entry.preparation = stager.prepare({ key: entry.key, operation: { deadline: budget.deadline, signal } });
    const outcomes = await Promise.allSettled([entry.preparation.result, entry.preparation.quiesced]);
    if (outcomes.some(value => value.status === 'rejected')) {
      entry.cleanupFailed = true; throw new InstallationError('cleanup');
    }
    const result = outcomes[0];
    if (result.status !== 'fulfilled') throw new InstallationError('cleanup');
    if (!result.value.ok) {
      if (result.value.reason === 'busy') { entry.prepared = false; return { kind: 'deferred', reason: 'staging_busy' }; }
      return abort(context, entry);
    }
    try { executionGuard(context, entry, budget); } catch { return abort(context, entry); }
    return result.value.value;
  } finally { context.releaseStage(); }
}
async function planFor(context: DriveContext, entry: Entry, offer: Offer | undefined, current: Reservation,
  budget: Operation): Promise<RuntimePlan | DriveProgress> {
  if (entry.plan) return entry.plan;
  if (!offer) throw new InstallationError('journal');
  const prepared = current.createToken ? recover(context.options.catalog, offer, current)
    : await stage(context, entry, offer, current, budget);
  if (!('kind' in prepared)) entry.plan = prepared;
  return prepared;
}
function controllerFor(context: DriveContext, entry: Entry, plan: RuntimePlan) {
  return createAttemptController({ journal: context.options.journal, supervisor: context.options.supervisor,
    input: { key: entry.key, plan }, collectOutputs, ...(context.options.wallNow ? { wallNow: context.options.wallNow } : {}) });
}
function unstartedWithoutWatch(entry: Entry, current: Reservation, ready: boolean): boolean {
  return !ready && !current.createToken && !entry.controller;
}
async function controllerStep(context: DriveContext, entry: Entry, offer: Offer | undefined, current: Reservation,
  budget: Operation): Promise<DriveProgress> {
  let launch = false;
  const timely = await ensureTimeoutWatch(context, entry, current, budget);
  if (unstartedWithoutWatch(entry, current, timely)) return abort(context, entry);
  const plan = await planFor(context, entry, offer, current, budget);
  if ('kind' in plan) return plan;
  const ready = await ensureOutputWatch(context, entry, current, budget);
  if (unstartedWithoutWatch(entry, current, ready)) return abort(context, entry);
  if (!entry.controller) {
    context.guard(entry, budget);
    entry.controller = controllerFor(context, entry, plan);
    launch = !current.createToken;
  }
  context.guard(entry, budget);
  if (entry.cancelled) {
    entry.cancellation ??= entry.controller.cancel();
    void entry.cancellation.catch(() => { entry.cleanupFailed = true; });
    launch = false;
  }
  const progress = await (launch ? entry.controller.launch(budget) : entry.controller.tick(budget));
  checkBudget(budget);
  if (progress.kind === 'released') await context.retire(entry, progress);
  return progress;
}
async function availableOffer(context: DriveContext, entry: Entry, budget: Operation): Promise<Offer | null> {
  try { return await context.options.journal.readOffer(entry.key); }
  catch (error) {
    context.guard(entry, budget);
    if (error instanceof JournalError && error.code === 'queue_full') return null;
    throw error;
  }
}
export async function drive(context: DriveContext, entry: Entry, budget: Operation): Promise<DriveProgress> {
  if (entry.cleanupFailed) throw new InstallationError('cleanup');
  context.guard(entry, budget);
  const recovery = await recoverSource(context, entry, budget);
  if ('progress' in recovery) return recovery.progress;
  const absence = await recoverAbsence({ journal: context.options.journal, entry, budget, intent: recovery.intent,
    guard: (owner, operation) => context.guard(owner, operation), retire: (owner, value) => context.retire(owner, value) });
  if (absence) return absence;
  const offer = entry.controller ? undefined : await availableOffer(context, entry, budget);
  context.guard(entry, budget);
  if (offer === null) return { kind: 'deferred', reason: 'journal_busy' };
  const current = await reservationFor(context, entry, offer, budget, recovery.intent);
  if (!('status' in current)) return current;
  const released = await retireReleased(context, entry, current);
  if (released) return released;
  if (!current.createToken && abandoned(entry)) return abort(context, entry);
  context.guard(entry, budget);
  return controllerStep(context, entry, offer, current, budget);
}
async function retireReleased(context: DriveContext, entry: Entry, current: Reservation): Promise<DriveProgress | null> {
  if (current.status !== 'released') return null;
  const progress = { kind: 'released' as const, collection: current.releaseEvidence?.collection.state ?? 'failed' as const };
  await context.retire(entry, progress); return progress;
}
async function reservationFor(context: DriveContext, entry: Entry, offer: Offer | undefined, budget: Operation,
  intent: CollectionIntent | null): Promise<Reservation | DriveProgress> {
  const current = await boundReservation(context, entry, offer, intent);
  if (current && !('status' in current)) return current;
  context.guard(entry, budget);
  if (current) return current;
  if (!context.acquireStage()) return { kind: 'deferred', reason: 'staging_busy' };
  context.releaseStage();
  return admit(context, entry, budget);
}

function abandoned(entry: Entry): boolean { return !entry.fresh || entry.cancelled; }
function pendingReservation(intent: CollectionIntent | null, current: Reservation | null): void {
  if (intent && !current?.createToken) throw new InstallationError('journal');
}

async function boundReservation(context: DriveContext, entry: Entry, offer: Offer | undefined,
  intent: CollectionIntent | null): Promise<Reservation | DriveProgress | null> {
  const current = await allocation(context.options.journal, entry.key);
  // A controller keeps its original bound plan and remains responsible for settlement.
  if (entry.controller || current?.status === 'released') return current;
  pendingReservation(intent, current);
  try {
    if (!offer) throw new InstallationError('catalog');
    if (current) context.options.catalog.resolve(offer, current.validation);
    else context.options.catalog.preflight(offer);
  } catch {
    if (intent) throw new InstallationError('catalog');
    const progress = { kind: 'rejected' as const, reason: 'installed_identity' };
    await context.retire(entry, progress); return progress;
  }
  return current;
}
