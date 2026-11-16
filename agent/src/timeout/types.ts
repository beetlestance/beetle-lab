import type { Scope } from '../admission/index.js';

export type TimeoutReason = 'timeout' | 'clock_integrity';
export interface TimeoutRequest {
  readonly key: Scope;
  readonly admittedAt: number;
  readonly timeoutMs: number;
  readonly clockHighWater: number;
  readonly clockFenced: boolean;
  /** Local monotonic time captured BEFORE the durable supervision read. Never serialized. */
  readonly sampledAt: number;
}
export interface TimeoutStatus {
  readonly ready: boolean; readonly closed: boolean; readonly stopRequested: boolean; readonly reason: TimeoutReason | null;
}
export interface TimeoutWatch {
  status(): TimeoutStatus;
  /** Fences callbacks and drains the original stop request; does not certify runtime exit. */
  close(): Promise<void>;
}
export interface TimeoutGuard {
  start(): void;
  watch(request: TimeoutRequest): TimeoutWatch;
  status(): TimeoutStatus & { readonly watched: number; readonly running: boolean };
  close(): Promise<void>;
}
export interface TimeoutOptions {
  readonly intervalMs?: number;
  readonly wallNow?: () => number;
  readonly monotonicNow?: () => number;
  stop(key: Scope, reason: TimeoutReason): Promise<unknown>;
}
export class TimeoutError extends Error {
  constructor(readonly reason: 'invalid_input' | 'closed' | 'capacity' | 'conflict' | 'cleanup') {
    super(`Timeout guard ${reason}`);
  }
}
