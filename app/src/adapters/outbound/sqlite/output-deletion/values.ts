import { validateApi } from '@beetle/contracts/api';
import type { WorkspaceScope } from '@beetle/contracts/api';
import { requireRule } from '../../../../domain/namespaces/index.js';
import { lower } from '../input-values.js';
export function closed(value: unknown, names: readonly string[]): asserts value is Record<string, unknown> {
  requireRule(value !== null && typeof value === 'object' && !Array.isArray(value));
  const keys = Object.keys(value); requireRule(keys.length === names.length && names.every(name => Object.hasOwn(value, name)));
}
export function natural(value: unknown, max = Number.MAX_SAFE_INTEGER, minimum = 0): asserts value is number {
  requireRule(typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= minimum && value <= max);
}
export function hash(value: unknown): asserts value is string {requireRule(typeof value === 'string' && /^[0-9a-f]{64}$/.test(value));}
export function uuid(value: unknown): string {requireRule(validateApi('Uuid', value).ok); return lower(value as string);}
export function scope(value: unknown): WorkspaceScope {
  requireRule(validateApi('WorkspaceScope', value).ok); const owned = value as WorkspaceScope;
  return {kind: 'workspace', organizationId: lower(owned.organizationId), workspaceId: lower(owned.workspaceId)};
}
