import { sqlTextColumn, sqlIntegerColumn } from './sql-columns.js';
import { validateApi } from '@beetle/contracts/api';
import type { WorkspaceScope } from '@beetle/contracts/api';
import type { InputRecord } from '../../../ports/inputs.js';
import { sameScope } from '../../../domain/namespaces/index.js';
import { lower } from './input-values.js';
import { StorageError } from './protocol.js';
const textColumns: [string, number, boolean][] = [
  ['id', 45, false],
  ['organization_id', 45, false],
  ['workspace_id', 45, false],
  ['folder_id', 45, false],
  ['name', 512, false],
  ['sha256', 64, false],
  ['state', 16, false],
  ['reason', 32, true],
  ['created_at', 40, true],
  ['published_at', 40, true],
];
const base = 'input_blobs.';
/** Fixed owner-defined projection; invalid nullable values cannot become null. */
export const inputColumns = [
  ...textColumns.map(([name, maximum, nullable]) => sqlTextColumn(name, maximum, nullable, base)),
  sqlIntegerColumn('bytes', false, base),
  sqlIntegerColumn('offset', false, base),
  sqlIntegerColumn('version', false, base),
  sqlIntegerColumn('row_count', true, 'input_shapes.'),
  sqlIntegerColumn('column_count', true, 'input_shapes.'),
  sqlIntegerColumn('revisions', true, 'input_usage_counts.', 'used_by_count'),
].join(',');
/** Primary-key lookups only: shapes and maintained pin counts never drive row order. */
export function inputSource(indexed = ''): string {
  const same = (table: string) =>
    `${table}.organization_id=input_blobs.organization_id AND ${table}.workspace_id=input_blobs.workspace_id
    AND ${table}.input_id=input_blobs.id`;
  return `input_blobs ${indexed} LEFT JOIN input_shapes ON ${same('input_shapes')}
    LEFT JOIN input_usage_counts ON ${same('input_usage_counts')}`;
}
export function inputRecord(input: unknown, expected?: WorkspaceScope): InputRecord {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new StorageError('unavailable');
  const row = input as Record<string, unknown>;
  const parsed = validateApi('InputRecord', {
    id: row.id,
    folderId: row.folder_id,
    name: row.name,
    sha256: row.sha256,
    bytes: row.bytes,
    offset: row.offset,
    version: row.version,
    state: row.state,
    reason: row.reason,
    scope: { kind: 'workspace', organizationId: row.organization_id, workspaceId: row.workspace_id },
    createdAt: row.created_at,
    publishedAt: row.published_at,
    rowCount: row.row_count,
    columnCount: row.column_count,
    usedByCount: row.used_by_count ?? 0,
  });
  if (!parsed.ok) throw new StorageError('unavailable');
  const value = parsed.value;
  if (expected !== undefined && !sameScope(value.scope, expected)) throw new StorageError('unavailable');
  validateProgress(value);
  return {
    ...value,
    id: lower(value.id),
    scope: {
      kind: 'workspace',
      organizationId: lower(value.scope.organizationId),
      workspaceId: lower(value.scope.workspaceId),
    },
  };
}

function validateProgress(value: InputRecord): void {
  if (value.offset > value.bytes) throw new StorageError('unavailable');
  if ((value.state === 'publishing' || value.state === 'published') && value.offset !== value.bytes)
    throw new StorageError('unavailable');
  const unpublished = value.state === 'staging' || value.state === 'publishing';
  const measured = value.rowCount !== null || value.columnCount !== null;
  if (unpublished && (value.publishedAt !== null || measured)) throw new StorageError('unavailable');
}
