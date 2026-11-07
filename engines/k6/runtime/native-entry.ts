/** Public native composition entrypoint; the separate index is adapter-driven. */
export { createNativeRuntime, nativeIteration, nativeSetup } from './native.js';
export { nativeOptions } from './options.js';
export { summaryProjection } from './summary.js';
export type { AttemptBudget } from './attempt.js';
