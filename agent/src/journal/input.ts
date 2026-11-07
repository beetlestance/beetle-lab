import { encodeJson, validate } from '@beetle/contracts';
import type { Offer } from '@beetle/contracts';
import type { AttemptKey, PageRequest } from './protocol.js';

export const MAX_OFFER_BYTES = 1_048_576;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function canonical(value: unknown): string {
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
  return { json, canonical: canonical(copy as Offer) };
}

export function attemptKey(input: AttemptKey): AttemptKey {
  const copy = JSON.parse(encodeJson(input, 512)) as AttemptKey;
  const fields = [copy.attemptId, copy.organizationId, copy.workspaceId];
  if (fields.some(value => typeof value !== 'string' || !uuid.test(value))) throw new Error('invalid_input');
  return { attemptId: copy.attemptId, organizationId: copy.organizationId, workspaceId: copy.workspaceId };
}

export function pageInput(input: PageRequest): PageRequest {
  const copy = JSON.parse(encodeJson(input, 128)) as PageRequest;
  if (!Number.isSafeInteger(copy.limit) || copy.limit < 1 || copy.limit > 100) throw new Error('invalid_input');
  if (copy.cursor !== undefined && (!Number.isSafeInteger(copy.cursor) || copy.cursor < 0)) throw new Error('invalid_input');
  return copy.cursor === undefined ? { limit: copy.limit } : { limit: copy.limit, cursor: copy.cursor };
}
