import type { InputRecord } from './inputs.js';

export interface InputByteContext {
  readonly signal?: AbortSignal;
  readonly freeSpaceReserveBytes: number;
}
export interface InputContentRange { readonly start: number; readonly endExclusive: number }
/** Called only after admission/current-state checks; at most one 1..64KiB chunk.
 * The source owns body-consumption bounds and its original read until settlement.
 */
export type InputChunkSource = () => Promise<Uint8Array>;
/** Resolve only after the original consumer write/backpressure completes. */
export interface InputContentSink { write(chunk: Uint8Array): Promise<void> }
export interface InputByteJob<T> {
  /** Success requires verification and successful original descriptor closes. */
  readonly result: Promise<T>;
  /** Resolves only after original custody is proven released, even on cancellation.
   * Failed close leaves this pending; the service retains its owner and fences intake.
   */
  readonly settled: Promise<void>;
}
export type InputByteErrorCode = 'invalid_input' | 'busy' | 'closed' | 'cancelled' |
  'custody_missing' | 'integrity' | 'io' | 'cleanup' | 'capacity_unavailable';
export class InputByteError extends Error {
  constructor(readonly code: InputByteErrorCode) { super('Input byte operation failed'); this.name = 'InputByteError'; }
}
/** Trusted records, captured by the service from the sole metadata worker.
 * The service owns global2/per-input1 capacity; this adapter adds no semaphore.
 * Native jobs retain handles through close, including failed-close custody.
 */
export interface InputByteStore {
  prepare(record: InputRecord, context: InputByteContext): InputByteJob<void>;
  /** Returns authoritative next offset; an identical earlier retry returns record.offset. */
  append(record: InputRecord, offset: number, source: InputChunkSource, context: InputByteContext): InputByteJob<number>;
  publish(record: InputRecord, context: InputByteContext): InputByteJob<void>;
  remove(record: InputRecord, context: InputByteContext): InputByteJob<void>;
  read(record: InputRecord, range: InputContentRange, sink: InputContentSink, context: InputByteContext): InputByteJob<void>;
}
