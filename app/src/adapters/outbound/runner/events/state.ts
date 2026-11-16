import { encodeCanonicalJson, encodeJson } from '@beetle/contracts';
import { captureEventBinding, expiryCoverage, EVENT_MAX_RETAINED_BYTES, EVENT_MAX_RETAINED_ROWS } from '../../../../domain/events/index.js';
import type { EventBinding, PreparedEventBatch } from '../../../../domain/events/index.js';
import { EVENT_STATE_BYTES } from '../../../../ports/events.js';
import type { EventCursorState, EventIngestResult } from '../../../../ports/events.js';

export function invalid(): never { throw new Error('Invalid event custody reply'); }

function plain(input: unknown): input is object {
  return input !== null && typeof input === 'object'
    && [Object.prototype, null].includes(Object.getPrototypeOf(input) as object | null);
}
function dataField(input: object, key: PropertyKey): unknown {
  const field = Object.getOwnPropertyDescriptor(input, key);
  if (!field || !field.enumerable || !('value' in field)) return invalid();
  return field.value as unknown;
}
/** Inspect fixed carriers without executing accessors or observing their payloads. */
export function fields(input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!plain(input)) return invalid();
  const keys = Reflect.ownKeys(input);
  if (keys.length > required.length + optional.length
    || keys.some(key => typeof key !== 'string' || ![...required, ...optional].includes(key))) return invalid();
  const result: Record<string, unknown> = {};
  for (const key of keys) result[key as string] = dataField(input, key);
  if (required.some(key => !Object.hasOwn(result, key))) return invalid();
  return result;
}
export function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}
export function sameBinding(actual: unknown, expected: EventBinding): EventBinding {
  const captured = captureEventBinding(actual);
  if (encodeCanonicalJson(captured, 2048) !== encodeCanonicalJson(expected, 2048)) return invalid();
  return captured;
}
function counters(value: Record<string, unknown>): void {
  if (!integer(value.durableThrough) || !integer(value.ackConfirmedThrough)
    || value.ackConfirmedThrough > value.durableThrough) return invalid();
  if (!integer(value.retainedBytes, EVENT_MAX_RETAINED_BYTES)
    || !integer(value.eventCount, EVENT_MAX_RETAINED_ROWS)) return invalid();
  if (value.eventCount !== value.durableThrough || (value.retainedBytes === 0) !== (value.eventCount === 0)) return invalid();
  if (value.retainedStartSeq !== null && !integer(value.retainedStartSeq)) return invalid();
}
function expired(value: Record<string, unknown>): void {
  if (value.coverage !== 'partial' || !integer(value.durableThrough) || !integer(value.retainedStartSeq)) return invalid();
  try { expiryCoverage(value.durableThrough, value.retainedStartSeq, value.durableThrough); }
  catch { return invalid(); }
}
function coverage(value: Record<string, unknown>): void {
  if (value.blockedReason !== null
    && !['cursor_expired', 'quota_exhausted', 'missing_receipt', 'replay_conflict'].includes(value.blockedReason as string)) return invalid();
  if (value.blockedReason === 'cursor_expired') return expired(value);
  if (value.coverage !== 'contiguous' || value.retainedStartSeq !== null) return invalid();
}
export function state(input: unknown, binding: EventBinding): EventCursorState {
  fields(input, ['binding', 'durableThrough', 'ackConfirmedThrough', 'coverage', 'blockedReason',
    'retainedStartSeq', 'retainedBytes', 'eventCount']);
  const value = JSON.parse(encodeJson(input, EVENT_STATE_BYTES)) as Record<string, unknown>;
  const captured = sameBinding(value.binding, binding);
  counters(value); coverage(value);
  return Object.freeze({ ...value, binding: captured }) as unknown as EventCursorState;
}
export function progress(current: EventCursorState, prior: EventCursorState): void {
  if (current.durableThrough < prior.durableThrough || current.ackConfirmedThrough < prior.ackConfirmedThrough
    || current.retainedBytes < prior.retainedBytes || current.eventCount < prior.eventCount) return invalid();
  const evidence = ['coverage', 'blockedReason', 'retainedStartSeq'] as const;
  if (prior.blockedReason !== null && evidence.some(field => current[field] !== prior[field])) return invalid();
}
function insertedCounters(inserted: number, current: EventCursorState, prior: EventCursorState, batch: PreparedEventBatch): void {
  const covered = Math.min(current.durableThrough, batch.nextCursor) - prior.durableThrough;
  const bytes = batch.records.slice(0, covered).reduce((total, record) => total + record.chargedBytes, 0);
  if (inserted > covered || covered > current.eventCount - prior.eventCount
    || bytes > current.retainedBytes - prior.retainedBytes) return invalid();
}
export function ingested(input: unknown, prior: EventCursorState, batch: PreparedEventBatch): EventIngestResult {
  const value = fields(input, ['state', 'inserted', 'ackThrough']);
  // Bound the complete small reply before interpreting any counters.
  encodeJson(input, EVENT_STATE_BYTES + 128);
  const current = state(value.state, prior.binding);
  progress(current, prior);
  if (!integer(value.inserted, batch.records.length) || !integer(value.ackThrough, current.durableThrough)) return invalid();
  const inserted = value.inserted;
  insertedCounters(inserted, current, prior, batch);
  if (current.blockedReason !== null) {
    if (inserted !== 0) return invalid();
  } else if (current.coverage !== 'contiguous' || current.durableThrough < batch.nextCursor
    || value.ackThrough < batch.nextCursor || value.ackThrough < prior.durableThrough) return invalid();
  return { state: current, inserted, ackThrough: value.ackThrough };
}
