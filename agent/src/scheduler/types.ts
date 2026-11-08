import type { InstallationController } from '../installation/index.js';
import type { Journal } from '../journal/index.js';

export interface SchedulerOptions {
  readonly journal: Pick<Journal, 'scanRunnable'>;
  readonly installation: Pick<InstallationController, 'drive'>;
  readonly intervalMs?: number;
  readonly operationTimeoutMs?: number;
  /** Same monotonic domain as Operation.deadline (performance.now), never wall time. */
  readonly monotonicNow?: () => number;
}
export interface SchedulerStatus {
  readonly running: boolean;
  readonly closed: boolean;
  readonly outstanding: number;
  readonly lastError: 'scan' | 'drive' | 'clock' | null;
}
export interface Scheduler {
  start(): void;
  status(): SchedulerStatus;
  /** Stops scheduling only; bootstrap retains installation/runtime shutdown ownership. */
  close(): Promise<void>;
}
export class SchedulerError extends Error {
  constructor(readonly reason: 'invalid_input' | 'closed') { super(`Scheduler ${reason}`); }
}
