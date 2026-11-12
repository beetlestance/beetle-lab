import { encodeCanonicalJson, encodeJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { Run } from '@beetle/contracts/api';
import { captureEventBinding } from '../../domain/events/index.js';
import type { EventBinding } from '../../ports/events.js';
import type { OutputFinalizationReply, OutputFinalizationRequest } from '../../ports/output-finalization.js';
import { OUTPUT_FINALIZATION_REPLY_BYTES } from '../../ports/output-finalization.js';
import type { OutputTransferOutcome } from '../../ports/output-transfer.js';

export function requireValue(condition: unknown): asserts condition {
  if (!condition) throw new Error('Invalid output runtime value');
}
export function fields(input: unknown, names: readonly string[]): Record<string, unknown> {
  requireValue(input !== null && typeof input === 'object'
    && [Object.prototype, null].includes(Object.getPrototypeOf(input) as object | null));
  const keys = Reflect.ownKeys(input);
  requireValue(keys.length === names.length && keys.every(key => typeof key === 'string' && names.includes(key)));
  const output: Record<string, unknown> = {};
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    requireValue(descriptor?.enumerable && 'value' in descriptor);
    output[name] = descriptor.value as unknown;
  }
  return output;
}
export function sameBinding(a: EventBinding, b: EventBinding): boolean {
  return encodeCanonicalJson(a, 2048) === encodeCanonicalJson(b, 2048);
}
function digest(value: unknown): asserts value is string {
  requireValue(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));
}
export function discriminator(value: unknown): unknown {
  requireValue(value !== null && typeof value === 'object');
  const property = Object.getOwnPropertyDescriptor(value, 'kind');
  requireValue(property && 'value' in property); return property.value as unknown;
}
export function transferValue(input: unknown, expected: EventBinding): OutputTransferOutcome {
  const kind = discriminator(input);
  if (kind === 'pending') { fields(input, ['kind']); return {kind}; }
  requireValue(kind === 'published');
  const value = fields(input, ['kind', 'binding', 'sourceDigest', 'manifestDigest']);
  const binding = captureEventBinding(value.binding); requireValue(sameBinding(binding, expected));
  digest(value.sourceDigest); digest(value.manifestDigest);
  return {kind, binding, sourceDigest: value.sourceDigest, manifestDigest: value.manifestDigest};
}
export function integer(value: unknown, minimum = 0): asserts value is number {
  requireValue(Number.isSafeInteger(value) && (value as number) >= minimum);
}
export function finalizationValue(input: OutputFinalizationReply, request: OutputFinalizationRequest, run: Run): void {
  const kind = discriminator(input);
  if (kind === 'pending') {
    const value = fields(input, ['kind', 'reason']);
    requireValue(['source', 'execution', 'events', 'artifacts', 'exit_evidence'].includes(value.reason as string)); return;
  }
  requireValue(kind === 'finalized'); const value = fields(input, ['kind', 'receipt']);
  const receipt = fields(value.receipt, ['binding', 'sourceDigest', 'manifestDigest', 'finalAgentSeq', 'retainedPayloadBytes',
    'refundedBytes', 'runVersion', 'state', 'outcome', 'validationStatus', 'reason']);
  const binding = captureEventBinding(receipt.binding); requireValue(sameBinding(binding, request.binding));
  digest(receipt.sourceDigest); digest(receipt.manifestDigest);
  requireValue(receipt.sourceDigest === request.sourceDigest && receipt.manifestDigest === request.manifestDigest);
  integer(receipt.finalAgentSeq); integer(receipt.retainedPayloadBytes); integer(receipt.refundedBytes); integer(receipt.runVersion, 1);
  requireValue(Number.isSafeInteger(receipt.retainedPayloadBytes + receipt.refundedBytes));
  requireValue(['finished', 'cancelled', 'errored'].includes(receipt.state as string));
  encodeJson({kind, receipt: {...receipt, binding}}, OUTPUT_FINALIZATION_REPLY_BYTES);
  terminal(receipt, run);
  requireValue(validateApi('Run', {...run, version: receipt.runVersion, state: receipt.state, outcome: receipt.outcome,
    validationStatus: receipt.validationStatus, reason: receipt.reason}).ok);
}
function terminal(receipt: Record<string, unknown>, run: Run): void {
  if (receipt.state === 'finished') {
    requireValue(receipt.validationStatus === 'passed' && receipt.reason === null
      && ['passed', 'failed', 'inconclusive'].includes(receipt.outcome as string)); return;
  }
  requireValue(receipt.outcome === 'inconclusive');
  if (receipt.state === 'cancelled') requireValue(run.cancellationRequested && receipt.reason === 'cancelled');
  else requireValue(receipt.reason !== null);
}
