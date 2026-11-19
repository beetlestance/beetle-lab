import { performance } from 'node:perf_hooks';
import { maximumWindowMs } from '../runtime-retirement/index.js';
import type { ReconcileKey, ReconcileRuntime } from './types.js';
/** Each attempt gets the longest retirement window, less a margin for admission latency. */
export const perAttemptMs = maximumWindowMs - 5_000;
export type ReconcileArguments = { readonly apply: boolean };
/** Exactly `reconcile` or `reconcile --apply`; anything else is a usage error. */
export function parseReconcileArguments(args: readonly string[]): ReconcileArguments | null {
  if (args.length === 0) return { apply: false };
  if (args.length === 1 && args[0] === '--apply') return { apply: true };
  return null;
}
function reason(error: unknown): string {
  const value = error && typeof error === 'object' && 'reason' in error ? error.reason : undefined;
  return typeof value === 'string' && /^[a-z_]{1,32}$/u.test(value) ? value : 'unavailable';
}
/**
 * Preview lists candidates from the Journal only. `--apply` reconciles them one at a time, one
 * bounded page after another; each line names the attempt and its outcome, never paths or
 * directory facts. The signal cancels the attempt in progress and admits no later attempt or
 * page. Returns the exit code: 0 when every attempt was current or reconciled, else 1.
 */
export async function runReconcileCommand(
  options: ReconcileArguments,
  runtime: ReconcileRuntime,
  write: (line: string) => void,
  signal: AbortSignal,
): Promise<number> {
  let attempts = 0;
  let refused = 0;
  let after: string | null = null;
  do {
    if (signal.aborted) break;
    const page = await runtime.candidates(after);
    for (const candidate of page.candidates) {
      if (signal.aborted) break;
      attempts += 1;
      if (options.apply) refused += await apply(runtime, candidate.key, write, signal);
      else write(JSON.stringify({ attemptId: candidate.key.attemptId, reconciled: candidate.reconciled }));
    }
    // Reconciled attempts stay listed until cleanup, so the cursor, not a re-read, moves on.
    after = page.next;
  } while (after !== null);
  const stopped = signal.aborted;
  write(JSON.stringify({ mode: options.apply ? 'apply' : 'preview', attempts, refused, stopped }));
  return refused > 0 || stopped ? 1 : 0;
}
async function apply(
  runtime: ReconcileRuntime,
  key: ReconcileKey,
  write: (line: string) => void,
  signal: AbortSignal,
): Promise<number> {
  try {
    const outcome = await runtime.reconcile(key, { deadline: performance.now() + perAttemptMs, signal });
    write(JSON.stringify({ attemptId: key.attemptId, outcome: outcome.state }));
    return 0;
  } catch (error) {
    write(JSON.stringify({ attemptId: key.attemptId, outcome: 'refused', reason: reason(error) }));
    return 1;
  }
}
