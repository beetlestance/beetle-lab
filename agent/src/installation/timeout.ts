import type { Reservation } from '../admission/index.js';
import type { Operation } from '../backends/docker/index.js';
import type { TimeoutReason } from '../timeout/index.js';
import type { SupervisionState } from '../journal/index.js';
import type { Entry } from './entry.js';
import type { InstallationOptions } from './types.js';

interface Context {
  readonly options: InstallationOptions;
  now(): number;
  guard(entry: Entry, budget: Operation): void;
  stopTimeout(entry: Entry, reason: TimeoutReason | 'artifact_incomplete'): Promise<void>;
}
async function register(context: Context, entry: Entry, current: Reservation, budget: Operation): Promise<boolean> {
  let sampledAt: number; let now: number;
  try {
    sampledAt = (context.options.monotonicNow ?? (() => performance.now()))();
    if (!Number.isFinite(sampledAt) || sampledAt < 0) throw new Error('Invalid monotonic clock');
    now = context.now();
  } catch { await context.stopTimeout(entry, 'clock_integrity'); return false; }
  context.guard(entry, budget);
  let state: SupervisionState;
  try { state = await context.options.journal.supervision({ key: entry.key, now }); }
  catch { await context.stopTimeout(entry, 'artifact_incomplete'); return false; }
  context.guard(entry, budget);
  try {
    entry.timeout = context.options.timeout.watch({ key: entry.key, admittedAt: current.admittedAt,
      timeoutMs: current.budget.timeoutMs, sampledAt, clockHighWater: state.clockHighWater, clockFenced: state.clockFenced });
  } catch {
    await context.stopTimeout(entry, 'artifact_incomplete');
    return false;
  }
  return true;
}
/** A delayed original metadata read consumes, rather than resets, the execution budget. */
export async function ensureTimeoutWatch(context: Context, entry: Entry, current: Reservation, budget: Operation): Promise<boolean> {
  if (!entry.timeout && !await register(context, entry, current, budget)) return false;
  if (!entry.timeout) return false;
  try { context.guard(entry, budget); }
  catch (error) {
    entry.timeoutClosing ??= entry.timeout.close();
    void entry.timeoutClosing.catch(() => { entry.cleanupFailed = true; });
    throw error;
  }
  const status = entry.timeout.status();
  if (!status.ready) await context.stopTimeout(entry, status.reason ?? 'artifact_incomplete');
  return status.ready && !entry.cancelled;
}
