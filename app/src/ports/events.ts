import type { DispatchKey } from './dispatch.js';
import { EVENT_BATCH_BYTES } from '../domain/events/index.js';
import type { EventBatchInput, EventBinding } from '../domain/events/index.js';
export { EVENT_BATCH_BYTES, EVENT_BATCH_COUNT, EVENT_RECORD_BYTES, EVENT_ROW_ALLOWANCE,
  EVENT_MAX_RETAINED_BYTES, EVENT_MAX_RETAINED_ROWS } from '../domain/events/index.js';
export type { EventBinding } from '../domain/events/index.js';

export const EVENT_COMMAND_BYTES = EVENT_BATCH_BYTES + 4096;
export const EVENT_STATE_BYTES = 4096;
export const EVENT_PAGE_BYTES = 65_536;
export const EVENT_CURSOR_BYTES = 1024;
export const EVENT_SCAN_LIMIT = 32;

/** Persisted physical authority; current capabilities cannot replace this binding. */
export type EventProblem = 'cursor_expired' | 'quota_exhausted' | 'missing_receipt' | 'replay_conflict';
export interface EventCursorState {
  readonly binding: EventBinding;
  readonly durableThrough: number;
  readonly ackConfirmedThrough: number;
  readonly coverage: 'contiguous' | 'partial';
  readonly blockedReason: EventProblem | null;
  readonly retainedStartSeq: number | null;
  readonly retainedBytes: number;
  readonly eventCount: number;
}
interface EventPosition { readonly order: number; readonly after: string }
export type EventCandidate = EventPosition & (
  { readonly kind: 'ready'; readonly binding: EventBinding }
  | { readonly kind: 'unbound'; readonly key: DispatchKey }
);
export interface EventScan { readonly limit: number; readonly cursor?: string }
export interface EventPage { readonly items: readonly EventCandidate[]; readonly nextCursor: string | null }
export type EventIngestRequest = EventBatchInput;
export interface EventIngestResult {
  readonly state: EventCursorState;
  readonly inserted: number;
  /** Authorizes at most this prefix, only after a successful durable transaction. */
  readonly ackThrough: number;
}
export interface EventAckRequest {
  readonly binding: EventBinding;
  readonly throughSeq: number;
  readonly receipt: unknown;
}
export interface EventProblemRequest {
  readonly binding: EventBinding;
  readonly after: number;
  readonly kind: EventProblem;
  /** Required only for a matched cursor_expired reply. Never advances the cursor. */
  readonly retainedStartSeq?: number;
}

/** Private metadata custody. No network I/O, Run projection or output release.
 * Ingest atomically stores an equal-replay/contiguous suffix and cursor before ACK.
 * Snapshot high-water, Offer ACK, durable events and remote ACK remain independent.
 * Every reply binds scope/run/digest/generation/physical authority and explicit bounds.
 */
export interface EventCustodyStore {
  scan(query: EventScan): Promise<EventPage>;
  load(binding: EventBinding): Promise<EventCursorState>;
  ingest(request: EventIngestRequest): Promise<EventIngestResult>;
  confirmAck(request: EventAckRequest): Promise<EventCursorState>;
  recordProblem(request: EventProblemRequest): Promise<EventCursorState>;
}
