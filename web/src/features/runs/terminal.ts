import type { Run } from '@beetle/contracts/api';

/** Finished, cancelled and errored runs are terminal; everything else is live. */
export function terminal(run: Run | undefined) {
  return run !== undefined && ['finished', 'cancelled', 'errored'].includes(run.state);
}
