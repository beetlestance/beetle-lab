import { reportFailure } from './failure.js';
/** Exit is process ownership: libraries fence storage and never retry writes. */
export function createStorageFailureExit(close: () => Promise<void>): (error: unknown) => void {
  let started = false;
  return (error) => {
    if (started) return;
    started = true;
    process.exitCode = 1;
    reportFailure('storage_failed', error);
    const timer = setTimeout(() => {
      reportFailure('shutdown_deadline', error);
      process.exit(1);
    }, 10000);
    timer.unref();
    void Promise.resolve()
      .then(close)
      .then(
        () => {
          clearTimeout(timer);
          process.exit(1);
        },
        (failure) => {
          reportFailure('shutdown_failed', failure);
          clearTimeout(timer);
          process.exit(1);
        },
      );
  };
}
