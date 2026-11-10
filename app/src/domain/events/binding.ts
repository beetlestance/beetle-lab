import { encodeJson, validatePrimitive } from '@beetle/contracts';
import { immutableSnapshot } from '../namespaces/index.js';
import { EventBatchError } from './types.js';
import type { EventBinding } from './types.js';

function closed(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
}
function logicalKey(value: Record<string, unknown>): void {
  if (!closed(value.key, ['runId', 'attempt'])) throw new Error();
  const attempt = value.key.attempt;
  if (!closed(attempt, ['organizationId', 'workspaceId', 'attemptId', 'generation', 'intentDigest'])) throw new Error();
  if (![value.key.runId, attempt.organizationId, attempt.workspaceId, attempt.attemptId]
    .every(id => validatePrimitive('uuid', id).ok)) throw new Error();
  if (attempt.generation !== 1 || typeof attempt.intentDigest !== 'string' || !/^[a-f0-9]{64}$/.test(attempt.intentDigest)) throw new Error();
}
/** Capture descriptor-safe original identity, without importing transport/storage owners. */
export function captureEventBinding(input: unknown): EventBinding {
  try {
    const value: unknown = JSON.parse(encodeJson(input, 2048));
    if (!closed(value, ['key', 'journalAuthority'])) throw new Error();
    logicalKey(value);
    if (typeof value.journalAuthority !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.journalAuthority)
      || !validatePrimitive('uuid', value.journalAuthority).ok) throw new Error();
    return immutableSnapshot(value) as unknown as EventBinding;
  } catch { throw new EventBatchError('invalid_binding'); }
}
