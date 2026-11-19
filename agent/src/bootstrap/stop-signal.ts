let captured: AbortController | undefined;
/**
 * SIGINT/SIGTERM for the offline `reconcile` command, captured once, first by the dispatcher
 * before the command module loads. The agent runs as PID 1 without an init, where the kernel
 * drops a signal that has no handler, so a stop sent while the command loads would be lost.
 */
export function reconcileStopSignal(): AbortSignal {
  if (!captured) {
    const abort = new AbortController();
    captured = abort;
    const stop = () => abort.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }
  return captured.signal;
}
