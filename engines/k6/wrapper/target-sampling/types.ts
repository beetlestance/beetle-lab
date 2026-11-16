export interface TargetSamplingConfig {
  readonly path: string;
  readonly intervalMs: number;
  readonly timeoutMs: number;
  readonly cooldownMs: number;
}
export { targetMetricNames } from '@beetle/contracts/target-runtime';
export type { TargetMetricName, TargetRuntimePhase as TargetSamplingPhase,
  TargetRuntimeReason as TargetSamplingReason, TargetRuntimeSample as TargetSamplingSample,
  TargetRuntimeReport as TargetSamplingReport } from '@beetle/contracts/target-runtime';
import type { TargetRuntimeReport } from '@beetle/contracts/target-runtime';
export interface TargetSamplingOptions {
  readonly target: string;
  readonly config: TargetSamplingConfig;
  readonly signal: AbortSignal;
  readonly fetch?: typeof globalThis.fetch;
}
export interface TargetSamplingOwner {
  finish(): Promise<TargetRuntimeReport>;
  close(): Promise<void>;
}
