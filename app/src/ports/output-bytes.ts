import type { EventBinding } from './events.js';
import type { OutputArtifactState } from './output-custody.js';

export const OUTPUT_CHUNK_BYTES = 65_536;
export const OUTPUT_FILE_RECORD_BYTES = 4096;
export interface OutputFileRecord {
  readonly binding: EventBinding;
  readonly artifact: OutputArtifactState;
}
export interface OutputFileContext {
  readonly signal?: AbortSignal;
  readonly deadline: number;
  readonly freeSpaceReserveBytes: number;
}
export interface OutputFileReceipt {
  readonly token: string;
  readonly offset: number;
  readonly phase: 'transferring' | 'published';
  readonly identity: string;
}
export interface OutputFileJob<T> {
  /** Positive result includes successful original closes and post-close checks. */
  readonly result: Promise<T>;
  /** Failed original close keeps this pending and retains the native owner. */
  readonly settled: Promise<void>;
}
export interface OutputAppendRequest {
  readonly record: OutputFileRecord;
  readonly offset: number;
  readonly bytes: Uint8Array;
}
export interface OutputReadRequest {
  readonly record: OutputFileRecord;
  readonly start: number;
  readonly endExclusive: number;
  readonly sink: { write(bytes: Uint8Array): Promise<void> };
}
export type OutputByteErrorCode = 'invalid_input' | 'busy' | 'closed' | 'cancelled' |
  'deadline' | 'custody_missing' | 'integrity' | 'io' | 'cleanup' | 'capacity_unavailable';
export class OutputByteError extends Error {
  constructor(readonly code: OutputByteErrorCode) {
    super('Output byte operation failed'); this.name = 'OutputByteError';
  }
}
/** Sole parent-owned namespace adapter, two jobs and one original per token.
 * Input is captured from the immutable metadata owner; it never resolves paths
 * from an engine-relative filename. No metadata mutation/refund occurs here.
 */
export interface OutputByteStore {
  prepare(record: OutputFileRecord, context: OutputFileContext): OutputFileJob<OutputFileReceipt>;
  append(request: OutputAppendRequest, context: OutputFileContext): OutputFileJob<OutputFileReceipt>;
  publish(record: OutputFileRecord, context: OutputFileContext): OutputFileJob<OutputFileReceipt>;
  read(request: OutputReadRequest, context: OutputFileContext): OutputFileJob<void>;
  /** Fences admission synchronously, drains originals, releases namespace lease last.
   * Cleanup failure is sticky: reject but retain lease and registry ownership.
   */
  close(): Promise<void>;
}
