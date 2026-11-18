export interface TargetSamplingConfig {
  readonly path: string;
  readonly intervalMs: number;
  readonly timeoutMs: number;
  readonly cooldownMs: number;
}
export { targetMetricNames } from '@beetle/contracts/target-runtime';
export type {
  TargetMetricName,
  TargetRuntimePhase as TargetSamplingPhase,
  TargetRuntimeReason as TargetSamplingReason,
  TargetRuntimeSample as TargetSamplingSample,
  TargetRuntimeReport as TargetSamplingReport,
} from '@beetle/contracts/target-runtime';
import type { TargetRuntimeReport } from '@beetle/contracts/target-runtime';
export interface TargetSamplingOptions {
  readonly target: string;
  readonly config: TargetSamplingConfig;
  readonly signal: AbortSignal;
  readonly fetch?: typeof globalThis.fetch;
  /** Wall clock shared with the attempt (and live frames); defaults to Date.now. */
  readonly wall?: () => number;
  /** Serial recording before retention; original work must settle even after abort. */
  readonly record?: (sample: TargetRuntimeReport['samples'][number], signal: AbortSignal) => Promise<void>;
}
export interface TargetSamplingOwner {
  /** Newest retained samples (at most `limit`, oldest first); frozen copies, no IO. */
  recent(limit: number): readonly TargetRuntimeReport['samples'][number][];
  finish(): Promise<TargetRuntimeReport>;
  close(): Promise<void>;
}
