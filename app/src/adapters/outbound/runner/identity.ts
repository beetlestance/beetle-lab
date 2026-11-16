import { encodeJson, validatePrimitive } from '@beetle/contracts';
import type { RunnerAttemptIdentity } from '../../../ports/runner.js';

const logicalFields = ['organizationId', 'workspaceId', 'attemptId', 'generation', 'intentDigest'] as const;
function journalAuthority(value: unknown): value is string {
  return typeof value === 'string' && value.length === 36 && value === value.toLowerCase()
    && validatePrimitive('uuid', value).ok;
}

export function captureIdentity(input: RunnerAttemptIdentity): RunnerAttemptIdentity {
  try {
    const value = JSON.parse(encodeJson(input, 1024)) as RunnerAttemptIdentity;
    if (!validatePrimitive('uuid', value.organizationId).ok
      || !validatePrimitive('uuid', value.workspaceId).ok
      || !validatePrimitive('uuid', value.attemptId).ok) throw new Error();
    if (!journalAuthority(value.journalAuthority)) throw new Error();
    if (!Number.isSafeInteger(value.generation) || value.generation < 1) throw new Error();
    if (typeof value.intentDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.intentDigest)) throw new Error();
    return Object.freeze({ journalAuthority: value.journalAuthority, organizationId: value.organizationId, workspaceId: value.workspaceId,
      attemptId: value.attemptId, generation: value.generation, intentDigest: value.intentDigest });
  } catch { throw new Error('Invalid runner identity'); }
}

export function matchesIdentity(value: object, identity: RunnerAttemptIdentity): boolean {
  const record = value as Record<string, unknown>;
  // Physical authority is bound by the authenticated header, never arbitrary engine JSON.
  return logicalFields.every(key => !(key in record) || record[key] === identity[key]);
}

/** Walk only schema-validated replies, including engine results nested in events. */
export function matchesReply(value: unknown, identity: RunnerAttemptIdentity): boolean {
  if (value === null || typeof value !== 'object') return true;
  if (!matchesIdentity(value, identity)) return false;
  return Object.values(value).every(child => matchesReply(child, identity));
}

export function scopeHeaders(identity?: RunnerAttemptIdentity): Record<string, string> {
  if (!identity) return {};
  return { 'x-beetle-organization-id': identity.organizationId,
    'x-beetle-workspace-id': identity.workspaceId, 'x-beetle-generation': String(identity.generation),
    'x-beetle-journal-authority': identity.journalAuthority };
}
