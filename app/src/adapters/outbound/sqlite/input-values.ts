import { createHash } from 'node:crypto';
import { encodeJson, validatePrimitive } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { SettingsScope } from '@beetle/contracts/api';
import { requireRule } from '../../../domain/namespaces/index.js';
import { StorageError } from './protocol.js';
export const MAX_MESSAGE_BYTES = 65536;
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
export const lower = (id: string): string => id.toLowerCase();
export const scopeKey = (scope: SettingsScope): string => {
  if (scope.kind === 'installation') return 'installation';
  if (scope.kind === 'organization') return `organization:${lower(scope.organizationId)}`;
  return `workspace:${lower(scope.organizationId)}:${lower(scope.workspaceId)}`;
};
export function uuid(value: string): void {
  if (!validatePrimitive('uuid', value).ok) throw new StorageError('invalid_input');
}
/** Physical journal authorities use one canonical lowercase wire representation. */
export function checkedJournalAuthority(value: unknown): void {
  requireRule(typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value));
}
export function boundedCopy<T>(input: T, limit = MAX_MESSAGE_BYTES): T {
  try { return JSON.parse(encodeJson(input, limit)) as T; }
  catch { throw new StorageError('invalid_input'); }
}
export function checkedScope(scope: SettingsScope): void {
  requireRule(validateApi('SettingsScope', scope).ok);
}
