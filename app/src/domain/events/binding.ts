import { encodeJson, validatePrimitive } from '@beetle/contracts';
import { immutableSnapshot } from '../namespaces/index.js';
import { EventBatchError } from './types.js';
import type { EventBinding } from './types.js';
import { captureFields } from './carrier.js';

function closed(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
}
/** Unbound diagnostic keys are validated without fabricating a physical authority. */
export function captureEventKey(input: unknown): EventBinding['key'] {
  try {
    const key = captureFields(input, ['runId', 'attempt']);
    const attempt = captureFields(key.attempt, ['organizationId', 'workspaceId', 'attemptId', 'generation', 'intentDigest']);
    const value: unknown = JSON.parse(encodeJson({ runId: key.runId, attempt }, 1024));
    logicalKey({ key: value });
    return immutableSnapshot(value) as EventBinding['key'];
  } catch { throw new EventBatchError('invalid_binding'); }
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
    const fields = captureFields(input, ['key', 'journalAuthority']);
    const value: unknown = JSON.parse(encodeJson({ key: captureEventKey(fields.key), journalAuthority: fields.journalAuthority }, 2048));
    if (!closed(value, ['key', 'journalAuthority'])) throw new Error();
    if (typeof value.journalAuthority !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.journalAuthority)
      || !validatePrimitive('uuid', value.journalAuthority).ok) throw new Error();
    return immutableSnapshot(value) as unknown as EventBinding;
  } catch { throw new EventBatchError('invalid_binding'); }
}
