import { validateApi } from '@beetle/contracts/api';
import type { SettingsScope } from '@beetle/contracts/api';
import { sameScope } from '../../../domain/namespaces/index.js';
import type { SettingsRecord } from '../../../domain/settings/index.js';
import type { SettingsIdentity } from '../../../ports/settings-reader.js';
import { StorageError } from './protocol.js';
function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new StorageError('unavailable');
  return input as Record<string, unknown>;
}
function scopeValue(row: Record<string, unknown>): unknown {
  switch (row.kind) {
    case 'installation':
      if (row.organization_id !== null || row.workspace_id !== null) throw new StorageError('unavailable');
      return { kind: 'installation' };
    case 'organization':
      if (row.workspace_id !== null) throw new StorageError('unavailable');
      return { kind: 'organization', organizationId: row.organization_id };
    case 'workspace':
      return { kind: 'workspace', organizationId: row.organization_id, workspaceId: row.workspace_id };
    default:
      throw new StorageError('unavailable');
  }
}
/** Identity-only reads deliberately never inspect defaults, versions or runtime. */
export function captureSettingsIdentity(input: unknown, expected: SettingsScope): SettingsIdentity {
  const row = record(input);
  const id = validateApi('Uuid', row.id);
  const scope = validateApi('SettingsScope', scopeValue(row));
  if (!id.ok || !scope.ok) throw new StorageError('unavailable');
  if (!sameScope(scope.value, expected)) throw new StorageError('unavailable');
  return { id: id.value, scope: scope.value };
}
export function captureSettingsRecord(input: unknown, expected: SettingsScope): SettingsRecord {
  const row = record(input);
  const identity = captureSettingsIdentity(row, expected);
  const version = validateApi('Version', row.version);
  if (!version.ok || typeof row.value_json !== 'string' || Buffer.byteLength(row.value_json) > 32768) {
    throw new StorageError('unavailable');
  }
  let value: unknown;
  try {
    value = JSON.parse(row.value_json) as unknown;
  } catch {
    throw new StorageError('unavailable');
  }
  const common = { ...identity, version: version.value, schemaVersion: 2 as const };
  if (identity.scope.kind === 'installation') {
    const values = validateApi('InstallationValues', value);
    if (!values.ok) throw new StorageError('unavailable');
    return { ...common, scope: identity.scope, values: values.value };
  }
  const overrides = validateApi('ScopedOverrides', value);
  if (!overrides.ok) throw new StorageError('unavailable');
  if (identity.scope.kind === 'organization') return { ...common, scope: identity.scope, overrides: overrides.value };
  return { ...common, scope: identity.scope, overrides: overrides.value };
}
