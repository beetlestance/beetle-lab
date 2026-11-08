import type { ControlScope, WrapperBatch, WrapperCheckpoint, WrapperCursor } from '../../control-protocol/index.js';

export const CONTROL_READ_BYTES = 262_144;
export const CONTROL_READ_CALLS = 8;
export const CONTROL_READ_MAX_MS = 30_000;
export type ControlReaderFactory = (options: ControlReaderOptions) => ControlReader;

export type ControlReadReason = 'invalid_options' | 'busy' | 'closed' | 'cancelled' | 'deadline'
  | 'io' | 'missing' | 'custody' | 'corruption' | 'checkpoint';
export class ControlReadError extends Error {
  constructor(readonly reason: ControlReadReason) { super(`Control reader ${reason}`); }
}
export interface ControlReaderOptions {
  readonly directory: string; readonly uid: number; readonly key: Readonly<ControlScope>;
  readonly checkpoint: Readonly<WrapperCheckpoint> | null;
}
export interface ControlReadBudget {
  /** Trusted absolute performance.now() deadline, never a staged timestamp. */
  readonly deadline: number; readonly signal?: AbortSignal;
  /** True only after the supervisor has established that the entire engine container stopped. */
  readonly stopped: boolean;
}
export type ControlReadValue =
  | { readonly kind: 'verifying'; readonly phase: 'restart' | 'final'; readonly verifiedBytes: number; readonly targetBytes: number }
  | { readonly kind: 'batch'; readonly request: Readonly<WrapperBatch> }
  | { readonly kind: 'caught_up'; readonly cursor: Readonly<WrapperCursor> | null;
      readonly tail: 'none' | 'incomplete'; readonly consistency: 'live_provisional' }
  | { readonly kind: 'caught_up'; readonly cursor: Readonly<WrapperCursor>;
      readonly tail: 'none'; readonly consistency: 'stopped_verified' };
export type ControlReadResult = { readonly ok: true; readonly value: ControlReadValue }
  | { readonly ok: false; readonly reason: ControlReadReason };
export interface ControlReadOperation {
  readonly result: Promise<ControlReadResult>;
  /** Issued original IO settled; an intentionally idle reader descriptor may remain until close(). */
  readonly quiesced: Promise<void>;
}
export interface ControlReader {
  read(budget: ControlReadBudget): ControlReadOperation;
  /** Synchronous acknowledgement of the sole pending batch; mismatches throw ControlReadError(checkpoint). */
  accept(checkpoint: Readonly<WrapperCheckpoint>): void;
  /** One cached outcome covering every issued operation and original descriptor close. */
  close(): Promise<void>;
}
