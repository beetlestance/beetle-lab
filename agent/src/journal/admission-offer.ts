import { encodeJson, RUNNER_MAXIMUM_OFFER_BYTES } from '@beetle/contracts';
import type { AdmissionCommand } from '../admission/index.js';
import { offerInput } from './input.js';

type OfferCommand = Extract<AdmissionCommand, { kind: 'offer' }>;
const fields = ['kind', 'offer', 'validation', 'now'] as const;
const carrierBytes = Buffer.byteLength('{"kind":"offer","offer":,"validation":,"now":}');

function ownData(input: unknown): Record<typeof fields[number], unknown> {
  if (input === null || typeof input !== 'object'
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input) as object | null)) throw new Error('invalid_input');
  const keys = Reflect.ownKeys(input);
  if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key as typeof fields[number]))) {
    throw new Error('invalid_input');
  }
  const values: Record<string, unknown> = {};
  for (const field of keys as Array<typeof fields[number]>) {
    const descriptor = Object.getOwnPropertyDescriptor(input, field);
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new Error('invalid_input');
    values[field] = descriptor.value;
  }
  return values as Record<typeof fields[number], unknown>;
}

/** Capture original limits independently of the fixed admission carrier's nodes/depth. */
export function captureAdmissionOffer(input: unknown): OfferCommand {
  const values = ownData(input);
  if (values.kind !== 'offer' || !Number.isSafeInteger(values.now)
    || typeof values.now !== 'number' || values.now < 0) throw new Error('invalid_input');
  const original = offerInput(values.offer);
  const validation = encodeJson(values.validation, 65_536);
  const now = JSON.stringify(values.now);
  // Count separately bounded encodings; never materialize a second joined carrier.
  const bytes = carrierBytes + Buffer.byteLength(original.json) + Buffer.byteLength(validation) + now.length;
  if (bytes > RUNNER_MAXIMUM_OFFER_BYTES + 65_536) throw new Error('invalid_input');
  return { ...values, kind: 'offer', offer: JSON.parse(original.json) as OfferCommand['offer'],
    validation: JSON.parse(validation) as OfferCommand['validation'], now: values.now };
}
