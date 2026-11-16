import type { openNativeMailbox } from '../live-mailbox/index.js';
import { runCompiledK6 } from '../execution/index.js';
import type { ExecutionClock } from '../execution/index.js';
/** Private deterministic engine boundary; not exported from the public entrypoint. */
export interface AttemptPorts {
  readonly execute: typeof runCompiledK6;
  readonly openMailbox?: typeof openNativeMailbox;
  readonly clock: ExecutionClock;
}
export const productionPorts: AttemptPorts = Object.freeze({ execute: runCompiledK6,
  clock: Object.freeze({ wall: Date.now, monotonic: performance.now.bind(performance) }) });
