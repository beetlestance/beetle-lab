import type { Offer } from '@beetle/contracts';
import type { AdmissionValue, Reservation } from '../admission/index.js';
import type { Operation, RuntimePlan } from '../backends/docker/index.js';
import { createAttemptController } from '../controller/index.js';
import { collectOutputs } from '../collection/output/index.js';
import { allocation, recover } from './recovery.js';
import { checkBudget } from './budget.js';
import { ensureOutputWatch } from './guard.js';
import type { Entry } from './entry.js';
import { InstallationError } from './types.js';
import type { DriveProgress, InstallationOptions } from './types.js';
export interface DriveContext {
  readonly options: InstallationOptions;
  now(): number;
  guard(entry: Entry, budget: Operation): void;
  acquireStage(): boolean;
  releaseStage(): void;
  retire(entry: Entry): Promise<void>;
  stopGuard(entry: Entry): Promise<void>;
}
const failed: DriveProgress = { kind: 'released', collection: 'failed' };
async function abort(context: DriveContext, entry: Entry): Promise<DriveProgress> {
  await context.options.journal.admission({ kind: 'abortUnstarted', key: entry.key });
  await context.retire(entry); return failed;
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
    const engine = context.options.catalog.resolve(offer, current.validation);
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
async function planFor(context: DriveContext, entry: Entry, offer: Offer, current: Reservation,
  budget: Operation): Promise<RuntimePlan | DriveProgress> {
  if (entry.plan) return entry.plan;
  const prepared = current.createToken ? recover(context.options.catalog, offer, current)
    : await stage(context, entry, offer, current, budget);
  if (!('kind' in prepared)) entry.plan = prepared;
  return prepared;
}
function controllerFor(context: DriveContext, entry: Entry, plan: RuntimePlan) {
  return createAttemptController({ journal: context.options.journal, supervisor: context.options.supervisor,
    input: { key: entry.key, plan }, collectOutputs, ...(context.options.wallNow ? { wallNow: context.options.wallNow } : {}) });
}
async function controllerStep(context: DriveContext, entry: Entry, offer: Offer, current: Reservation,
  budget: Operation): Promise<DriveProgress> {
  let launch = false;
  const plan = await planFor(context, entry, offer, current, budget);
  if ('kind' in plan) return plan;
  const ready = await ensureOutputWatch(context, entry, current, budget);
  if (!ready && !current.createToken && !entry.controller) return abort(context, entry);
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
  if (progress.kind === 'released') await context.retire(entry);
  return progress;
}
export async function drive(context: DriveContext, entry: Entry, budget: Operation): Promise<DriveProgress> {
  if (entry.cleanupFailed) throw new InstallationError('cleanup');
  context.guard(entry, budget);
  const offer = await context.options.journal.readOffer(entry.key); context.guard(entry, budget);
  let current = await allocation(context.options.journal, entry.key);
  if (!current) {
    if (!context.acquireStage()) return { kind: 'deferred', reason: 'staging_busy' };
    context.releaseStage();
    const admitted = await admit(context, entry, budget);
    if (!('status' in admitted)) return admitted;
    current = admitted;
  }
  if (current.status === 'released') { await context.retire(entry); return { kind: 'released', collection: current.releaseEvidence?.collection.state ?? 'failed' }; }
  if (!current.createToken && abandoned(entry)) return abort(context, entry);
  context.guard(entry, budget);
  return controllerStep(context, entry, offer, current, budget);
}

function abandoned(entry: Entry): boolean { return !entry.fresh || entry.cancelled; }
