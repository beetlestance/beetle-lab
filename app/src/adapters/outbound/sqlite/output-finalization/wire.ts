import { encodeCanonicalJson, runnerSchemas } from '@beetle/contracts';
import { captureEventBinding } from '../../../../domain/events/index.js';
import { requireRule } from '../../../../domain/namespaces/index.js';
import { OUTPUT_FINALIZATION_REQUEST_BYTES, OUTPUT_FINALIZATION_REPLY_BYTES } from '../../../../ports/output-finalization.js';
import type { OutputFinalizationRequest, OutputFinalizationReply, OutputFinalizationReceipt } from '../../../../ports/output-finalization.js';
import { boundedCopy } from '../input-values.js';
export interface FinalizationOperation { kind: 'outputFinalize'; request: OutputFinalizationRequest }
function closed(value: object, fields: readonly string[]): void {
  requireRule(value !== null && typeof value === 'object' && Reflect.ownKeys(value).length === fields.length
    && fields.every(field => Object.hasOwn(value, field)));
}
function natural(value: unknown): asserts value is number {
  requireRule(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}
function hex(value: unknown): void { requireRule(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)); }
export function finalizationOperation(input: unknown): input is FinalizationOperation {
  if (!input || typeof input !== 'object') return false;
  const descriptor = Object.getOwnPropertyDescriptor(input, 'kind');
  return !!descriptor && 'value' in descriptor && descriptor.value === 'outputFinalize';
}
export function captureFinalizationOperation(input: unknown): FinalizationOperation {
  const copy = boundedCopy(input, OUTPUT_FINALIZATION_REQUEST_BYTES) as FinalizationOperation & { messageId?: number };
  requireRule(finalizationOperation(copy));
  closed(copy, Object.hasOwn(copy, 'messageId') ? ['kind', 'request', 'messageId'] : ['kind', 'request']);
  if (Object.hasOwn(copy, 'messageId')) { natural(copy.messageId); requireRule(copy.messageId > 0); }
  closed(copy.request, ['binding', 'sourceDigest', 'manifestDigest', 'expectedRunVersion']);
  const request = copy.request;
  hex(request.sourceDigest); hex(request.manifestDigest); natural(request.expectedRunVersion); requireRule(request.expectedRunVersion > 0);
  return { kind: 'outputFinalize', request: { ...request, binding: captureEventBinding(request.binding) } };
}
function projection(value: OutputFinalizationReceipt): void {
  requireRule(['finished', 'cancelled', 'errored'].includes(value.state));
  requireRule(['passed', 'failed', 'inconclusive'].includes(value.outcome));
  requireRule(['pending', 'passed', 'failed'].includes(value.validationStatus));
  const reasons = runnerSchemas.find(schema => schema.title === 'Common')?.$defs.reason.enum;
  requireRule(value.reason === null || !!reasons?.some(reason => reason === value.reason));
  if (value.state === 'finished') requireRule(value.validationStatus === 'passed' && value.reason === null);
  else requireRule(value.outcome === 'inconclusive' && value.reason !== null);
  if (value.state === 'cancelled') requireRule(value.reason === 'cancelled');
  else requireRule(value.reason !== 'cancelled');
}
export function captureFinalizationReply(operation: FinalizationOperation, input: unknown): OutputFinalizationReply {
  const copy = boundedCopy(input, OUTPUT_FINALIZATION_REPLY_BYTES) as OutputFinalizationReply;
  if (copy.kind === 'pending') {
    closed(copy, ['kind', 'reason']);
    requireRule(['source', 'execution', 'events', 'artifacts', 'exit_evidence'].includes(copy.reason));
    return copy;
  }
  closed(copy, ['kind', 'receipt']); requireRule(copy.kind === 'finalized');
  const receipt = copy.receipt;
  closed(receipt, ['binding', 'sourceDigest', 'manifestDigest', 'finalAgentSeq', 'retainedPayloadBytes', 'refundedBytes',
    'runVersion', 'state', 'outcome', 'validationStatus', 'reason']);
  requireRule(encodeCanonicalJson(captureEventBinding(receipt.binding), 2048) === encodeCanonicalJson(operation.request.binding, 2048));
  hex(receipt.sourceDigest); hex(receipt.manifestDigest);
  requireRule(receipt.sourceDigest === operation.request.sourceDigest && receipt.manifestDigest === operation.request.manifestDigest);
  [receipt.finalAgentSeq, receipt.retainedPayloadBytes, receipt.refundedBytes, receipt.runVersion].forEach(natural);
  requireRule(receipt.runVersion >= 2 && Number.isSafeInteger(receipt.retainedPayloadBytes + receipt.refundedBytes));
  projection(receipt); return copy;
}
