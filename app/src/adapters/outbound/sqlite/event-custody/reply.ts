import { validate } from '@beetle/contracts';
import { EVENT_BATCH_COUNT } from '../../../../ports/events.js';
import type { EventIngestResult, EventPage, EventCursorState, EventAckRequest, EventProblemRequest, EventBinding } from '../../../../ports/events.js';
import { captureEventBinding, expiryCoverage } from '../../../../domain/events/index.js';
import { requireRule } from '../../../../domain/namespaces/index.js';
import { boundedCopy } from '../input-values.js';
import { captureDispatchKey } from '../dispatch-values.js';
import type { EventOperation } from './wire.js';
import { eventReplyLimit } from './wire.js';
import { captureState, closed, cursor, natural } from './values.js';
export type EventValue = EventPage | ReturnType<typeof captureState> | EventIngestResult;
function page(value: EventPage, limit: number): void {
  closed(value, ['items', 'nextCursor']); requireRule(Array.isArray(value.items) && value.items.length <= limit);
  for (const item of value.items) {
    closed(item, item.kind === 'ready' ? ['kind', 'binding', 'order', 'after'] : ['kind', 'key', 'order', 'after']);
    natural(item.order); cursor(item.after);
    if (item.kind === 'ready') captureEventBinding(item.binding);
    else { requireRule(item.kind === 'unbound'); captureDispatchKey(item.key); }
  }
  if (value.nextCursor !== null) { cursor(value.nextCursor); requireRule(value.items.length > 0 && value.nextCursor === value.items.at(-1)!.after); }
}
export function captureEventReply(operation: EventOperation, input: unknown): EventValue {
  const value = boundedCopy(input, eventReplyLimit(operation)) as EventValue;
  requireRule(value !== null && typeof value === 'object');
  if (operation.kind === 'eventScan') { page(value as EventPage, operation.query.limit); return value; }
  const binding = operation.kind === 'eventLoad' ? operation.binding : operation.request.binding;
  if (operation.kind === 'eventIngest') {
    ingested(value as EventIngestResult, binding);
  } else {
    const state = captureState(value, binding);
    if (operation.kind === 'eventConfirmAck') confirmation(state, operation.request);
    if (operation.kind === 'eventProblem') problem(state, operation.request);
  }
  return value;
}

function confirmation(state: EventCursorState, request: EventAckRequest): void {
  const receipt = validate('AckReceipt', request.receipt);
  requireRule(receipt.ok && state.ackConfirmedThrough >= receipt.value.acknowledgedSeq);
}
function problem(state: EventCursorState, request: EventProblemRequest): void {
  requireRule(request.after <= state.durableThrough);
  if (request.kind === 'cursor_expired'
    && expiryCoverage(request.after, request.retainedStartSeq!, state.durableThrough) === 'covered') return;
  requireRule(state.blockedReason !== null);
}

function ingested(result: EventIngestResult, binding: EventBinding): void {
    closed(result, ['state', 'inserted', 'ackThrough']);
    const state = captureState(result.state, binding); natural(result.inserted); natural(result.ackThrough);
    requireRule(result.inserted <= EVENT_BATCH_COUNT && result.inserted <= state.eventCount && result.ackThrough <= state.durableThrough
      && (state.blockedReason === null || result.inserted === 0));
}
