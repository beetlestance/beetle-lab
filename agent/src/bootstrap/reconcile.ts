import { reportFailure } from './failure.js';
import { loadAgentConfiguration } from './configuration.js';
import { openReconcileRuntime } from './runtime.js';
import { parseReconcileArguments, runReconcileCommand } from './reconcile-command.js';
import type { ReconcileRuntime } from './types.js';

/**
 * Offline operator command (decision 030), run as `reconcile [--apply]` in a one-off container
 * while the serving agent is stopped. It takes the same exclusive process owner as serving, so it
 * refuses while an agent holds the installation; it never listens or schedules. SIGINT/SIGTERM
 * cancel the attempt in progress, admit nothing further, then close before the owner is released.
 */
process.umask(0o077);
const options = parseReconcileArguments(process.argv.slice(3));
if (!options) {
  process.stderr.write('Usage: reconcile [--apply]\n');
  process.exitCode = 2;
} else {
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let providerClose: (() => Promise<void>) | undefined;
  let runtime: ReconcileRuntime | undefined;
  try {
    const loaded = await loadAgentConfiguration(process.env, new URL('./worker.js', import.meta.url), abort.signal);
    providerClose = loaded.close;
    runtime = await openReconcileRuntime(loaded.runtime);
    process.exitCode = await runReconcileCommand(
      options,
      runtime,
      (line) => process.stdout.write(`${line}\n`),
      abort.signal,
    );
  } catch (error) {
    reportFailure('startup_failed', error);
    process.stderr.write('Beetle Lab reconcile failed. Stop the agent and check installation access.\n');
    process.exitCode = 1;
  } finally {
    const outcomes = await Promise.allSettled([runtime?.close(), providerClose?.()]);
    if (outcomes.some((value) => value.status === 'rejected')) {
      reportFailure('shutdown_failed', new Error('Reconcile cleanup incomplete'));
      process.exitCode = 1;
    }
  }
}
