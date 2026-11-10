import { encodeCanonicalJson, runnerSchemas } from '@beetle/contracts';
import { captureOutputAbsence } from '@beetle/contracts/output-source';
import { captureEventBinding } from '../../../../domain/events/index.js';
import { requireRule } from '../../../../domain/namespaces/index.js';
import type { EventBinding } from '../../../../ports/events.js';
import type { OutputAbsenceAdoptRequest, OutputAbsenceFinalizeRequest, OutputAbsenceState,
  OutputAbsenceFinalizationReply } from '../../../../ports/output-absence.js';
import { boundedCopy, sha256 } from '../input-values.js';
export type AbsenceOperation = { kind: 'absenceRead'; binding: EventBinding }
 | { kind: 'absenceAdopt'; request: OutputAbsenceAdoptRequest }
 | { kind: 'absenceFinalize'; request: OutputAbsenceFinalizeRequest };
export type AbsenceValue = OutputAbsenceState | OutputAbsenceFinalizationReply | null;
function closed(value: object, fields: readonly string[]): void {
  requireRule(value !== null && typeof value === 'object' && Reflect.ownKeys(value).length === fields.length
    && fields.every(field => Object.hasOwn(value, field)));
}
function natural(value: unknown): asserts value is number {
  requireRule(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}
function hex(value: unknown): void { requireRule(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)); }
export function absenceOperation(input: unknown): input is AbsenceOperation {
  if (!input || typeof input !== 'object') return false;
  const descriptor = Object.getOwnPropertyDescriptor(input, 'kind');
  return !!descriptor && 'value' in descriptor && ['absenceRead', 'absenceAdopt', 'absenceFinalize'].includes(descriptor.value as string);
}
export function captureAbsenceOperation(input: unknown): AbsenceOperation {
  const copy = boundedCopy(input, 4096) as AbsenceOperation & { messageId?: number };
  requireRule(absenceOperation(copy));
  const fields = ['kind', copy.kind === 'absenceRead' ? 'binding' : 'request'];
  if (Object.hasOwn(copy, 'messageId')) { fields.push('messageId'); natural(copy.messageId); requireRule(copy.messageId > 0); }
  closed(copy, fields);
  if (copy.kind === 'absenceRead') return { kind: copy.kind, binding: captureEventBinding(copy.binding) };
  const request = copy.request; const binding = captureEventBinding(request.binding);
  if (copy.kind === 'absenceAdopt') {
    closed(request, ['binding', 'closure']);
    return { kind: copy.kind, request: { binding, closure: captureOutputAbsence(copy.request.closure,
      { ...binding.key.attempt, journalAuthority: binding.journalAuthority }) } };
  }
  closed(request, ['binding', 'proofDigest', 'expectedRunVersion']);
  hex(copy.request.proofDigest); natural(copy.request.expectedRunVersion); requireRule(copy.request.expectedRunVersion > 0);
  return { kind: copy.kind, request: { ...copy.request, binding } };
}
function sameBinding(actual: EventBinding, expected: EventBinding): void {
  requireRule(encodeCanonicalJson(captureEventBinding(actual), 2048) === encodeCanonicalJson(expected, 2048));
}
export function captureAbsenceState(input: unknown, binding: EventBinding): OutputAbsenceState {
  const copy = boundedCopy(input, 4096) as OutputAbsenceState;
  closed(copy, ['binding', 'proofDigest', 'closure']); sameBinding(copy.binding, binding); hex(copy.proofDigest);
  const closure = captureOutputAbsence(copy.closure, { ...binding.key.attempt, journalAuthority: binding.journalAuthority });
  requireRule(sha256(encodeCanonicalJson(closure, 2048)) === copy.proofDigest);
  return { binding: captureEventBinding(copy.binding), proofDigest: copy.proofDigest, closure };
}
export function captureAbsenceReply(operation: AbsenceOperation, input: unknown): AbsenceValue {
  if (operation.kind !== 'absenceFinalize') return stateReply(operation, input);
  return finalizationReply(operation, input);
}
function stateReply(operation: Exclude<AbsenceOperation, { kind: 'absenceFinalize' }>, input: unknown): OutputAbsenceState | null {
  if (operation.kind === 'absenceRead' && input === null) return null;
  const binding = operation.kind === 'absenceRead' ? operation.binding : operation.request.binding;
  const state = captureAbsenceState(input, binding);
  if (operation.kind === 'absenceAdopt') requireRule(encodeCanonicalJson(state.closure, 2048)
    === encodeCanonicalJson(operation.request.closure, 2048));
  return state;
}
function finalizationReply(operation: Extract<AbsenceOperation, { kind: 'absenceFinalize' }>, input: unknown): OutputAbsenceFinalizationReply {
  const copy = boundedCopy(input, 4096) as OutputAbsenceFinalizationReply;
  if (copy.kind === 'pending') {
    closed(copy, ['kind', 'reason']); requireRule(['proof', 'execution', 'events'].includes(copy.reason)); return copy;
  }
  closed(copy, ['kind', 'receipt']); requireRule(copy.kind === 'finalized');
  const r = copy.receipt;
  closed(r, ['binding', 'proofDigest', 'finalAgentSeq', 'retainedPayloadBytes', 'refundedBytes', 'runVersion',
    'state', 'outcome', 'validationStatus', 'reason']);
  sameBinding(r.binding, operation.request.binding); hex(r.proofDigest); requireRule(r.proofDigest === operation.request.proofDigest);
  [r.finalAgentSeq, r.retainedPayloadBytes, r.refundedBytes, r.runVersion].forEach(natural);
  requireRule(r.runVersion >= 2 && Number.isSafeInteger(r.retainedPayloadBytes + r.refundedBytes));
  const reasons = runnerSchemas.find(schema => schema.title === 'Common')?.$defs.reason.enum;
  requireRule(!!reasons?.some(reason => reason === r.reason));
  requireRule(r.outcome === 'inconclusive' && r.validationStatus === 'pending');
  requireRule(r.state === 'cancelled' ? r.reason === 'cancelled' : r.state === 'errored' && r.reason !== 'cancelled');
  return copy;
}
