import type { AttemptIdentity } from '../runs/index.js';

export const EVENT_BATCH_BYTES = 262_144;
export const EVENT_BATCH_COUNT = 100;
/** Agent control frame plus the producer's bounded authoritative envelope. */
export const EVENT_RECORD_BYTES = 66_048;
export const EVENT_ROW_ALLOWANCE = 128;
export const EVENT_MAX_RETAINED_BYTES = 67_108_864;
export const EVENT_MAX_RETAINED_ROWS = 65_536;
export interface EventBinding {
  readonly key: { readonly runId: string; readonly attempt: AttemptIdentity & { generation: 1 } };
  readonly journalAuthority: string;
}
export interface EventBatchInput {
  readonly binding: EventBinding;
  readonly after: number;
  readonly batch: unknown;
}
export interface EventRecord {
  readonly seq: number;
  readonly canonical: string;
  readonly chargedBytes: number;
}
export interface PreparedEventBatch {
  readonly binding: EventBinding;
  readonly after: number;
  readonly nextCursor: number;
  readonly retainedStartSeq: number;
  readonly records: readonly EventRecord[];
}
export type EventBatchFailure = 'invalid_binding' | 'invalid_batch' | 'identity_mismatch' | 'sequence_gap' | 'cursor_expired';
export class EventBatchError extends Error {
  constructor(readonly code: EventBatchFailure) { super(`Event batch ${code}`); }
}
