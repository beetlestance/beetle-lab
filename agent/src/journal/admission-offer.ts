import { encodeJson, RUNNER_MAXIMUM_OFFER_BYTES, EXPORT_ASSIGNMENT_BYTES } from '@beetle/contracts';
import type { AdmissionCommand } from '../admission/index.js';
import { captureExport } from './export-assignment.js';
import { offerInput } from './input.js';

type OfferCommand = Extract<AdmissionCommand, { kind: 'offer' }>;
const required = ['kind', 'offer', 'validation', 'now'] as const;
const fields = [...required,'assignment'] as const;
const carrierBytes = Buffer.byteLength('{"kind":"offer","offer":,"validation":,"now":}');

function ownData(input: unknown): Record<typeof required[number], unknown> & {assignment?: unknown} {
  if (input === null || typeof input !== 'object'
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input) as object | null)) throw new Error('invalid_input');
  const keys = Reflect.ownKeys(input);
  if (!validKeys(keys)) {
    throw new Error('invalid_input');
  }
  const values: Record<string, unknown> = {};
  for (const field of keys as Array<typeof fields[number]>) {
    const descriptor = Object.getOwnPropertyDescriptor(input, field);
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new Error('invalid_input');
    values[field] = descriptor.value;
  }
  return values as Record<typeof required[number], unknown> & {assignment?: unknown};
}

/** Capture original limits independently of the fixed admission carrier's nodes/depth. */
export function captureAdmissionOffer(input: unknown): OfferCommand {
  const values = ownData(input);
  if (values.kind !== 'offer' || !Number.isSafeInteger(values.now)
    || typeof values.now !== 'number' || values.now < 0) throw new Error('invalid_input');
  const original = offerInput(values.offer);
  const assignment=captureAssignment(values,original);
  const assignmentBytes=assignment ? Buffer.byteLength(encodeJson(assignment,EXPORT_ASSIGNMENT_BYTES)) + 14 : 0;
  const validation = encodeJson(values.validation, 65_536);
  const now = JSON.stringify(values.now);
  // Count separately bounded encodings; never materialize a second joined carrier.
  const bytes = carrierBytes + Buffer.byteLength(original.json) + Buffer.byteLength(validation) + now.length + assignmentBytes;
  if (bytes > RUNNER_MAXIMUM_OFFER_BYTES + EXPORT_ASSIGNMENT_BYTES + 65_536) throw new Error('invalid_input');
  const {assignment: _assignment,...carrier}=values; void _assignment;
  return { ...carrier, ...(assignment ? {assignment} : {}), kind: 'offer', offer: JSON.parse(original.json) as OfferCommand['offer'],
    validation: JSON.parse(validation) as OfferCommand['validation'], now: values.now };
}

function validKeys(keys:readonly PropertyKey[]):boolean {
  return required.every(key=>keys.includes(key)) && keys.length<=fields.length
    && keys.every(key=>typeof key==='string' && fields.includes(key as typeof fields[number]));
}
function captureAssignment(values: ReturnType<typeof ownData>,original:ReturnType<typeof offerInput>): OfferCommand['assignment'] {
  const assignment=Object.hasOwn(values,'assignment') ? captureExport(values.assignment) : undefined;
  if (assignment && offerInput(assignment.offer).canonical !== original.canonical) throw new Error('invalid_input');
  if (!assignment && (JSON.parse(original.json) as OfferCommand['offer']).requiredCapabilities.includes('standalone-export-v1')) throw new Error('invalid_input');
  return assignment;
}
