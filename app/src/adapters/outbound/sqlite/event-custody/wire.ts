import { encodeJson } from '@beetle/contracts';
import { captureEventBinding, prepareEventBatch } from '../../../../domain/events/index.js';
import { requireRule } from '../../../../domain/namespaces/index.js';
import type { EventIngestRequest } from '../../../../ports/events.js';
import { EVENT_BATCH_BYTES, EVENT_COMMAND_BYTES, EVENT_PAGE_BYTES, EVENT_STATE_BYTES } from '../../../../ports/events.js';
import type { Operation } from '../protocol.js';
import { boundedCopy } from '../input-values.js';
import { ackRequest, closed, problemRequest, scanQuery } from './values.js';
export type EventOperation = Extract<Operation, { kind: 'eventScan' | 'eventLoad' | 'eventIngest' | 'eventConfirmAck' | 'eventProblem' }>;
const kinds = ['eventScan', 'eventLoad', 'eventIngest', 'eventConfirmAck', 'eventProblem'];
export function data(input: unknown, name: string): unknown {
  requireRule(input !== null && typeof input === 'object');
  requireRule([Object.prototype, null].includes(Object.getPrototypeOf(input) as object | null));
  const field = Object.getOwnPropertyDescriptor(input, name);
  requireRule(field !== undefined && field.enumerable === true && 'value' in field);
  return field.value as unknown;
}
export function eventOperation(input: unknown): input is EventOperation {
  if (input === null || typeof input !== 'object') return false;
  const field = Object.getOwnPropertyDescriptor(input, 'kind');
  return !!field && 'value' in field && kinds.includes(field.value as string);
}
function control(input: unknown, fields: readonly string[]): unknown {
  data(input, fields[0]!); closed(input as object, fields);
  const values = fields.map(field => [field, field === 'binding' ? captureEventBinding(data(input, field)) : data(input, field)]);
  return boundedCopy(Object.fromEntries(values), 4096);
}
function optional(input: unknown, field: string): boolean {
  return input !== null && typeof input === 'object' && Object.hasOwn(input, field);
}
function ingest(input: unknown): EventIngestRequest {
  const binding = captureEventBinding(data(input, 'binding')); const after = data(input, 'after'); const batch = data(input, 'batch');
  closed(input as object, ['binding', 'after', 'batch']);
  const fixed = boundedCopy({ binding, after }, EVENT_STATE_BYTES);
  const owned: unknown = JSON.parse(encodeJson(batch, EVENT_BATCH_BYTES));
  const request = { binding: captureEventBinding(fixed.binding), after: fixed.after as number, batch: owned };
  prepareEventBatch(request);
  return request;
}
export function captureEventOperation(input: EventOperation): EventOperation {
  const kind = data(input, 'kind') as EventOperation['kind'];
  requireRule(kinds.includes(kind));
  const field = kind === 'eventScan' ? 'query' : kind === 'eventLoad' ? 'binding' : 'request';
  const body = data(input, field);
  envelope(input, field);
  switch (kind) {
    case 'eventScan': { const query = control(body, optional(body, 'cursor') ? ['limit', 'cursor'] : ['limit']) as Extract<EventOperation, {kind: 'eventScan'}>['query']; scanQuery(query); return {kind, query}; }
    case 'eventLoad': return { kind, binding: captureEventBinding(body) };
    case 'eventIngest': return { kind, request: ingest(body) };
    case 'eventConfirmAck': { const request = control(body, ['binding', 'throughSeq', 'receipt']) as Extract<EventOperation, {kind: 'eventConfirmAck'}>['request']; ackRequest(request); return {kind, request}; }
    case 'eventProblem': { const request = control(body, optional(body, 'retainedStartSeq') ? ['binding', 'after', 'kind', 'retainedStartSeq'] : ['binding', 'after', 'kind']) as Extract<EventOperation, {kind: 'eventProblem'}>['request']; problemRequest(request); return {kind, request}; }
  }
}
export function eventRequestLimit(operation: EventOperation): number { return operation.kind === 'eventIngest' ? EVENT_COMMAND_BYTES : EVENT_STATE_BYTES; }
export function eventReplyLimit(operation: EventOperation): number { return operation.kind === 'eventScan' ? EVENT_PAGE_BYTES : EVENT_STATE_BYTES; }

function envelope(input: EventOperation, field: string): void {
  const id = Object.getOwnPropertyDescriptor(input, 'messageId');
  closed(input, id ? ['kind', field, 'messageId'] : ['kind', field]);
  if (id) { const messageId = data(input, 'messageId'); requireRule(typeof messageId === 'number' && Number.isSafeInteger(messageId) && messageId > 0); }
}
