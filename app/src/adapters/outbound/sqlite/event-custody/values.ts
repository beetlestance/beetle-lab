import { EVENT_CURSOR_BYTES, EVENT_STATE_BYTES, EVENT_MAX_RETAINED_ROWS, EVENT_MAX_RETAINED_BYTES, EVENT_SCAN_LIMIT } from '../../../../ports/events.js';
import { encodeCanonicalJson, validate } from '@beetle/contracts';
import type { EventAckRequest, EventBinding, EventCursorState, EventProblemRequest, EventScan } from '../../../../ports/events.js';
import { captureEventBinding, expiryCoverage } from '../../../../domain/events/index.js';
import { requireRule } from '../../../../domain/namespaces/index.js';
import { boundedCopy } from '../input-values.js';

export function closed(value: object, fields: readonly string[]): void {
  requireRule(Reflect.ownKeys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key)));
}
export function natural(value: unknown): asserts value is number {
  requireRule(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}
export function sameBinding(actual: unknown, expected: EventBinding): void {
  requireRule(encodeCanonicalJson(captureEventBinding(actual), 2048) === encodeCanonicalJson(expected, 2048));
}
export function scanQuery(value: EventScan): void {
  closed(value, value.cursor === undefined ? ['limit'] : ['limit', 'cursor']);
  natural(value.limit); requireRule(value.limit >= 1 && value.limit <= EVENT_SCAN_LIMIT);
  if (value.cursor !== undefined) cursor(value.cursor);
}
export function cursor(value: unknown): asserts value is string {
  requireRule(typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= EVENT_CURSOR_BYTES);
}
export function ackRequest(value: EventAckRequest): void {
  closed(value, ['binding', 'throughSeq', 'receipt']); captureEventBinding(value.binding); natural(value.throughSeq);
  const receipt = validate('AckReceipt', value.receipt);
  requireRule(receipt.ok);
  const actual = receipt.value; const expected = value.binding.key.attempt;
  requireRule(actual.organizationId === expected.organizationId && actual.workspaceId === expected.workspaceId
    && actual.attemptId === expected.attemptId && actual.generation === expected.generation);
  requireRule(actual.acknowledgedSeq >= value.throughSeq);
}
export function problemRequest(value: EventProblemRequest): void {
  closed(value, value.retainedStartSeq === undefined ? ['binding', 'after', 'kind'] : ['binding', 'after', 'kind', 'retainedStartSeq']);
  captureEventBinding(value.binding); natural(value.after);
  requireRule(['cursor_expired', 'quota_exhausted', 'missing_receipt', 'replay_conflict'].includes(value.kind));
  if (value.kind === 'cursor_expired') expiryCoverage(value.after, value.retainedStartSeq!, value.after);
  else requireRule(value.retainedStartSeq === undefined);
}
export function captureState(input: unknown, binding: EventBinding): EventCursorState {
  const state = boundedCopy(input, EVENT_STATE_BYTES) as EventCursorState;
  requireRule(state !== null && typeof state === 'object');
  closed(state, ['binding', 'durableThrough', 'ackConfirmedThrough', 'coverage', 'blockedReason', 'retainedStartSeq', 'retainedBytes', 'eventCount']);
  sameBinding(state.binding, binding);
  [state.durableThrough, state.ackConfirmedThrough, state.retainedBytes, state.eventCount].forEach(natural);
  requireRule(state.eventCount === state.durableThrough && state.eventCount <= EVENT_MAX_RETAINED_ROWS
    && state.retainedBytes <= EVENT_MAX_RETAINED_BYTES && (state.eventCount === 0) === (state.retainedBytes === 0)
    && state.ackConfirmedThrough <= state.durableThrough);
  coverage(state);
  return state;
}

function coverage(state: EventCursorState): void {
  requireRule(state.blockedReason === null || ['cursor_expired', 'quota_exhausted', 'missing_receipt', 'replay_conflict'].includes(state.blockedReason));
  if (state.blockedReason === 'cursor_expired') {
    natural(state.retainedStartSeq);
    requireRule(state.coverage === 'partial' && state.retainedStartSeq > state.durableThrough
      && state.retainedStartSeq - state.durableThrough > 1);
  } else requireRule(state.coverage === 'contiguous' && state.retainedStartSeq === null);
}
