import type { StandaloneExportInput, StandaloneExportOutput, StandaloneExportCode } from './types.js';
export interface StandaloneBuildInput extends StandaloneExportInput {
  readonly signal: AbortSignal;
  /** Fixed caller-owned monotonic deadline in the same domain as performance.now. */
  readonly deadline: number;
}
export type StandaloneBuildCode = StandaloneExportCode | 'cancelled' | 'closed' | 'deadline' | 'clock_fenced';
export class StandaloneBuildError extends Error {
  constructor(readonly code: StandaloneBuildCode) {super('Standalone build rejected');}
}
export interface StandaloneBuildOperation {
  readonly result: Promise<StandaloneExportOutput>;
  /** Original opaque API call only, not proof of native/child/container quiescence. */
  readonly settled: Promise<void>;
  close(): Promise<void>;
}
