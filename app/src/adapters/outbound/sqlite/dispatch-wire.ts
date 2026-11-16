import { encodeCanonicalJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import { requireRule } from '../../../domain/namespaces/index.js';
import { mergeAttemptObservation } from '../../../domain/runs/index.js';
import { DISPATCH_CURSOR_BYTES, DISPATCH_SCAN_LIMIT, DISPATCH_PAGE_BYTES,
  DISPATCH_OFFER_REPLY_BYTES, DISPATCH_OBSERVATION_REQUEST_BYTES } from '../../../ports/dispatch.js';
import type { DispatchKey, DispatchScan, DispatchPage, DispatchCandidate, DispatchOffer,
  DispatchClaim, DispatchObservation } from '../../../ports/dispatch.js';
import { captureDispatchKey } from './dispatch-values.js';
import { captureDispatchOfferReply } from './dispatch-offer-reply.js';
import { checkedJournalAuthority, boundedCopy } from './input-values.js';
import type { Operation } from './protocol.js';

export type DispatchOperation = Extract<Operation, {
  kind: 'dispatchScan' | 'dispatchReadOffer' | 'dispatchClaim' | 'dispatchObserve';
}>;
export type DispatchValue = DispatchPage | DispatchOffer | DispatchClaim | DispatchObservation;
const kinds = ['dispatchScan', 'dispatchReadOffer', 'dispatchClaim', 'dispatchObserve'];
const reasons = ['capacity_unknown', 'profile_unavailable', 'per_run_ceiling', 'budget_unavailable',
  'staging_unavailable', 'storage_unavailable', 'isolated', 'isolated_predecessor',
  'not_queued', 'untracked_intent', 'ownership_unknown'];

/** Tag inspection never invokes caller accessors; capture validates the full value. */
export function dispatchOperation(input: unknown): input is DispatchOperation {
  if (input === null || typeof input !== 'object') return false;
  const descriptor = Object.getOwnPropertyDescriptor(input, 'kind');
  return !!descriptor && 'value' in descriptor && kinds.includes(descriptor.value as string);
}
function closed(input: object, fields: readonly string[]): void {
  requireRule(Object.keys(input).length === fields.length && fields.every(field => Object.hasOwn(input, field)));
}
function cursor(input: unknown): void {
  requireRule(typeof input === 'string' && input.length > 0 && Buffer.byteLength(input) <= DISPATCH_CURSOR_BYTES);
}
function scan(input: DispatchScan): void {
  requireRule(input !== null && typeof input === 'object');
  closed(input, input.cursor === undefined ? ['lane', 'limit'] : ['lane', 'limit', 'cursor']);
  requireRule(input.lane === 'queued' || input.lane === 'reconcile');
  requireRule(Number.isSafeInteger(input.limit) && input.limit >= 1 && input.limit <= DISPATCH_SCAN_LIMIT);
  if (input.cursor !== undefined) cursor(input.cursor);
}
function sameKey(actual: DispatchKey, expected: DispatchKey): void {
  requireRule(encodeCanonicalJson(actual, 1024) === encodeCanonicalJson(expected, 1024));
}
function boundSnapshot(key: DispatchKey, snapshot: unknown): void {
  mergeAttemptObservation({ expected: key.attempt, previous: null, incoming: snapshot });
}
/** Internal envelope allowance is separate from the unchanged private request cap. */
export function dispatchRequestLimit(operation: DispatchOperation): number {
  return operation.kind === 'dispatchObserve' ? DISPATCH_OBSERVATION_REQUEST_BYTES + 1024 : 65_536;
}
export function dispatchReplyLimit(operation: DispatchOperation): number {
  if (operation.kind === 'dispatchReadOffer') return DISPATCH_OFFER_REPLY_BYTES;
  return operation.kind === 'dispatchObserve' ? 1_048_576 : DISPATCH_PAGE_BYTES;
}
function operationEnvelope(value: DispatchOperation): void {
  const field = value.kind === 'dispatchScan' ? 'query' : value.kind === 'dispatchObserve' ? 'request' : 'key';
  closed(value, Object.hasOwn(value, 'messageId') ? ['kind', field, 'messageId'] : ['kind', field]);
  if (Object.hasOwn(value, 'messageId')) {
    const id: unknown = Reflect.get(value, 'messageId');
    requireRule(typeof id === 'number' && Number.isSafeInteger(id) && id > 0);
  }
}
export function captureDispatchOperation(input: DispatchOperation): DispatchOperation {
  requireRule(dispatchOperation(input));
  const value = boundedCopy(input, dispatchRequestLimit(input));
  operationEnvelope(value);
  switch (value.kind) {
    case 'dispatchScan': scan(value.query); break;
    case 'dispatchReadOffer': case 'dispatchClaim': captureDispatchKey(value.key); break;
    case 'dispatchObserve': {
      const request = boundedCopy(value.request, DISPATCH_OBSERVATION_REQUEST_BYTES);
      requireRule(request !== null && typeof request === 'object'); closed(request, ['key', 'snapshot', 'journalAuthority']);
      checkedJournalAuthority(request.journalAuthority);
      const key = captureDispatchKey(request.key); boundSnapshot(key, request.snapshot); break;
    }
  }
  return value;
}
function captureCandidate(item: DispatchCandidate): void {
  requireRule(item !== null && typeof item === 'object'); closed(item, ['key', 'order', 'after', 'eligibility']);
  captureDispatchKey(item.key); cursor(item.after);
  requireRule(Number.isSafeInteger(item.order) && item.order >= 0);
  const eligibility = item.eligibility;
  requireRule(eligibility !== null && typeof eligibility === 'object');
  closed(eligibility, eligibility.kind === 'blocked' ? ['kind', 'reason'] : ['kind']);
  requireRule(eligibility.kind === 'ready' || eligibility.kind === 'blocked' && reasons.includes(eligibility.reason));
}
function capturePage(value: DispatchPage, query: DispatchScan): void {
  closed(value, ['items', 'nextCursor']);
  requireRule(Array.isArray(value.items) && value.items.length <= query.limit);
  if (value.nextCursor !== null) {
    cursor(value.nextCursor); requireRule(value.items.length > 0);
    requireRule(value.nextCursor === value.items.at(-1)?.after);
  }
  for (const item of value.items) captureCandidate(item);
}
function captureClaim(value: DispatchClaim, expected: DispatchKey): void {
  switch (value.kind) {
    case 'claimed': case 'replay':
      closed(value, ['kind', 'key', 'journalAuthority']); checkedJournalAuthority(value.journalAuthority);
      sameKey(captureDispatchKey(value.key), expected); break;
    case 'acknowledged': closed(value, ['kind', 'journalAuthority']); checkedJournalAuthority(value.journalAuthority); break;
    case 'blocked': closed(value, ['kind', 'reason']); requireRule(reasons.includes(value.reason)); break;
    default: requireRule(false);
  }
}
function captureObservation(value: DispatchObservation, expected: DispatchKey): void {
  closed(value, ['run', 'snapshot', 'executionCharged', 'runChanged']);
  requireRule(validateApi('Run', value.run).ok);
  const run = value.run;
  requireRule(run.id === expected.runId && run.activeAttemptId === expected.attempt.attemptId
    && run.scope.organizationId === expected.attempt.organizationId && run.scope.workspaceId === expected.attempt.workspaceId);
  boundSnapshot(expected, value.snapshot);
  requireRule(typeof value.executionCharged === 'boolean' && typeof value.runChanged === 'boolean');
}
/** Both worker producer and parent consumer bind bounded replies to the request. */
export function captureDispatchReply(operation: DispatchOperation, input: unknown): DispatchValue {
  if (operation.kind === 'dispatchReadOffer') return captureDispatchOfferReply(input, operation.key);
  const value = boundedCopy(input, dispatchReplyLimit(operation)) as DispatchValue;
  requireRule(value !== null && typeof value === 'object');
  switch (operation.kind) {
    case 'dispatchScan': capturePage(value as DispatchPage, operation.query); break;
    case 'dispatchClaim': captureClaim(value as DispatchClaim, operation.key); break;
    case 'dispatchObserve': captureObservation(value as DispatchObservation, operation.request.key); break;
  }
  return value;
}
