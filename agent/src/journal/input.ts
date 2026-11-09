import { encodeJson, RUNNER_MAXIMUM_OFFER_BYTES, validate, validatePrimitive } from '@beetle/contracts';
import type { Offer } from '@beetle/contracts';
import type { AttemptKey, PageRequest, RunnableRequest } from './protocol.js';

export const MAX_OFFER_BYTES = RUNNER_MAXIMUM_OFFER_BYTES;

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
}

export function offerInput(input: unknown): { json: string; canonical: string } {
  const json = encodeJson(input, MAX_OFFER_BYTES);
  const copy: unknown = JSON.parse(json);
  if (!validate('Offer', copy).ok) throw new Error('invalid_input');
  // Compare complete bounded JSON, without resolving references or hashing secrets.
  const sorted = canonical(copy as Offer);
  if (Buffer.byteLength(sorted) > MAX_OFFER_BYTES) throw new Error('invalid_input');
  return { json, canonical: sorted };
}

export function attemptKey(input: AttemptKey): AttemptKey {
  const copy = JSON.parse(encodeJson(input, 512)) as AttemptKey;
  const fields = [copy.attemptId, copy.organizationId, copy.workspaceId];
  if (fields.some(value => !validatePrimitive('uuid', value).ok)) throw new Error('invalid_input');
  return { attemptId: copy.attemptId, organizationId: copy.organizationId, workspaceId: copy.workspaceId };
}

export function pageInput(input: PageRequest): PageRequest {
  const copy = JSON.parse(encodeJson(input, 128)) as PageRequest;
  if (!Number.isSafeInteger(copy.limit) || copy.limit < 1 || copy.limit > 100) throw new Error('invalid_input');
  if (copy.cursor !== undefined && (!Number.isSafeInteger(copy.cursor) || copy.cursor < 0)) throw new Error('invalid_input');
  return copy.cursor === undefined ? { limit: copy.limit } : { limit: copy.limit, cursor: copy.cursor };
}

export function runnableInput(input: RunnableRequest): RunnableRequest {
  const copy = JSON.parse(encodeJson(input, 192)) as RunnableRequest;
  if (copy.lane !== 'charged' && copy.lane !== 'queued') throw new Error('invalid_input');
  if (Object.keys(copy).some(key => !['lane', 'limit', 'cursor'].includes(key))) throw new Error('invalid_input');
  return { ...pageInput({ limit: copy.limit, ...(copy.cursor === undefined ? {} : { cursor: copy.cursor }) }), lane: copy.lane };
}
