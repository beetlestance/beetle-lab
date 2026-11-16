import { encodeJson, validate, RUNNER_MAXIMUM_OFFER_BYTES } from '@beetle/contracts';
import type { Offer } from '@beetle/contracts';
import type { DispatchKey, DispatchOffer } from '../../../ports/dispatch.js';
import { DISPATCH_OFFER_REPLY_BYTES } from '../../../ports/dispatch.js';
import { requireRule } from '../../../domain/namespaces/index.js';
import { captureDispatchKey } from './dispatch-values.js';

function carrierValues(input: unknown): { key: unknown; offer: unknown } {
  requireRule(input !== null && typeof input === 'object');
  requireRule([Object.prototype, null].includes(Object.getPrototypeOf(input) as object | null));
  const fields = Reflect.ownKeys(input);
  requireRule(fields.length === 2 && fields.includes('key') && fields.includes('offer'));
  const key = Object.getOwnPropertyDescriptor(input, 'key');
  const offer = Object.getOwnPropertyDescriptor(input, 'offer');
  requireRule(key !== undefined && 'value' in key && offer !== undefined && 'value' in offer);
  return { key: key.value as unknown, offer: offer.value as unknown };
}
function requireExpected(key: DispatchKey, expected: DispatchKey): void {
  requireRule(key.runId === expected.runId && key.attempt.attemptId === expected.attempt.attemptId
    && key.attempt.organizationId === expected.attempt.organizationId && key.attempt.workspaceId === expected.attempt.workspaceId
    && key.attempt.intentDigest === expected.attempt.intentDigest && key.attempt.generation === expected.attempt.generation);
}
function requireOriginal(offer: Offer, key: DispatchKey): void {
  requireRule(offer.attemptId === key.attempt.attemptId && offer.organizationId === key.attempt.organizationId
    && offer.workspaceId === key.attempt.workspaceId && offer.intentDigest === key.attempt.intentDigest);
}
/** Preserve original Offer caps; the fixed carrier adds nine nodes and one depth.
 * Capture each bounded subtree separately: a generic whole-carrier encoder would
 * apply the original-root limits again and reject valid originals at their caps.
 */
export function captureDispatchOfferReply(input: unknown, expected: DispatchKey): DispatchOffer {
  const values = carrierValues(input);
  const key = captureDispatchKey(values.key);
  requireExpected(key, captureDispatchKey(expected));
  const offerJson = encodeJson(values.offer, RUNNER_MAXIMUM_OFFER_BYTES);
  const captured: unknown = JSON.parse(offerJson);
  const checked = validate('Offer', captured);
  requireRule(checked.ok);
  const offer = checked.value;
  requireOriginal(offer, key);
  const keyJson = encodeJson(key, 1024);
  // Fixed delimiters are {"key": + ,"offer": + }, without escaped JSON text.
  requireRule(Buffer.byteLength(keyJson) + Buffer.byteLength(offerJson) + 17 <= DISPATCH_OFFER_REPLY_BYTES);
  return { key, offer };
}
