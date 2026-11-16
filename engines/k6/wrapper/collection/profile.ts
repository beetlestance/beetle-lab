import type { SummaryOptions } from './types.js';

/** Capture trusted admission references before invoking clocks or issuing IO. */
export function snapshotOptions(options: SummaryOptions): SummaryOptions {
  return Object.freeze({ ...options, wallNow: options.wallNow ?? Date.now,
    process: Object.freeze({ ...options.process }) });
}
