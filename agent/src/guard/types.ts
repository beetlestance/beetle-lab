import type { Scope } from '../admission/index.js';
import type { RuntimePlan } from '../backends/docker/index.js';
import type { VerifiedRoot } from '../staging/index.js';

export type GuardStopReason = 'output_limit' | 'artifact_incomplete';
export interface OutputWatchRequest { readonly key: Scope; readonly plan: RuntimePlan; readonly outputBytes: number }
export interface OutputWatchStatus {
  readonly ready: boolean; readonly closed: boolean; readonly stopRequested: boolean; readonly lastKnownAt: number | null;
}
export interface OutputWatch {
  readonly initial: Promise<{ readonly ready: boolean }>;
  status(): OutputWatchStatus;
  /** Fences callbacks and waits for original scans/stop requests; never certifies runtime exit. */
  close(): Promise<void>;
}
export interface OutputGuardStatus { readonly ready: boolean; readonly running: boolean; readonly closed: boolean; readonly watched: number }
export interface OutputGuard {
  start(): void;
  watch(request: OutputWatchRequest): OutputWatch;
  status(): OutputGuardStatus;
  close(): Promise<void>;
}
export interface OutputGuardOptions {
  readonly root: VerifiedRoot;
  readonly minimumFreeBytes: number;
  readonly intervalMs?: number;
  readonly ttlMs?: number;
  readonly sampleTimeoutMs?: number;
  readonly monotonicNow?: () => number;
  /** Resolving acknowledges intent only; installation retains runtime termination ownership. */
  stop(key: Scope, reason: GuardStopReason): Promise<unknown>;
}
export class GuardError extends Error {
  constructor(readonly reason: 'invalid_input' | 'closed' | 'capacity' | 'conflict' | 'cleanup') { super(`Output guard ${reason}`); }
}
