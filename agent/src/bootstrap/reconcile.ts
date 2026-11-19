import { reportFailure } from './failure.js';
import { loadAgentConfiguration } from './configuration.js';
import { openReconcileRuntime } from './runtime.js';
import { parseReconcileArguments, runReconcileCommand } from './reconcile-command.js';
import type { ReconcileArguments } from './reconcile-command.js';
import { reconcileStopSignal } from './stop-signal.js';
import type { ReconcileRuntime } from './types.js';

/**
 * Offline operator command (decision 030), run as `reconcile [--apply]` in a one-off container
 * while the serving agent is stopped. It takes the same exclusive process owner as serving, so it
 * refuses while an agent holds the installation; it never listens or schedules. SIGINT/SIGTERM,
 * captured by the dispatcher before this module loads, cancel the attempt in progress and admit
 * nothing further, then close before the owner is released. A stop before the first page reports
 * the same `stopped` summary as a stop between attempts, never a startup failure.
 */
process.umask(0o077);
const write = (line: string) => process.stdout.write(`${line}\n`);
const options = parseReconcileArguments(process.argv.slice(3));
if (!options) {
  process.stderr.write('Usage: reconcile [--apply]\n');
  process.exitCode = 2;
} else {
  const signal = reconcileStopSignal();
  let providerClose: (() => Promise<void>) | undefined;
  let runtime: ReconcileRuntime | undefined;
  try {
    if (signal.aborted) process.exitCode = stopped(options);
    else {
      const loaded = await loadAgentConfiguration(process.env, new URL('./worker.js', import.meta.url), signal);
      providerClose = loaded.close;
      runtime = await openReconcileRuntime(loaded.runtime);
      process.exitCode = await runReconcileCommand(options, runtime, write, signal);
    }
  } catch (error) {
    process.exitCode = signal.aborted ? stopped(options, error) : failed(error);
  } finally {
    const outcomes = await Promise.allSettled([runtime?.close(), providerClose?.()]);
    if (outcomes.some((value) => value.status === 'rejected')) {
      reportFailure('shutdown_failed', new Error('Reconcile cleanup incomplete'));
      process.exitCode = 1;
    }
  }
}
/** Stopped while starting: nothing was attempted. The interrupted step's codes stay visible. */
function stopped(options: ReconcileArguments, error?: unknown): number {
  if (error !== undefined) reportFailure('startup_stopped', error);
  write(JSON.stringify({ mode: options.apply ? 'apply' : 'preview', attempts: 0, refused: 0, stopped: true }));
  return 1;
}
function failed(error: unknown): number {
  reportFailure('startup_failed', error);
  process.stderr.write('Beetle Lab reconcile failed. Stop the agent and check installation access.\n');
  return 1;
}
