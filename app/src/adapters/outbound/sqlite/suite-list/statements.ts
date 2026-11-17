import type { SQLInputValue } from 'node:sqlite';
import { validateApi } from '@beetle/contracts/api';
import type { NormalizedSuiteListQuery, SuiteGroup, WorkspaceScope } from '@beetle/contracts/api';
import { captureNamespaceId, namespaceIdColumn } from '../namespace-rows.js';
import { sqlTextColumn } from '../sql-columns.js';
import { StorageError } from '../protocol.js';

/** Stored group; 'no_revision' is the private half of public 'no_runs' (see migration034). */
export type StoredGroup = SuiteGroup | 'no_revision';
const RUN_GROUPS = ['in_progress', 'passed', 'failed', 'inconclusive', 'stopped'] as const;
const STORED_GROUPS: readonly StoredGroup[] = [...RUN_GROUPS, 'no_runs', 'no_revision'];
export interface SuiteKey {
  id: string;
  folder_id: string;
  folded_name: string;
  latest_run_id: string | null;
  latest_requested_at: string;
  latest_group: StoredGroup;
}
/** Position after which the next page starts; requestedAt '' sorts suites without Runs last. */
export type SuiteAfter =
  { order: 'recent_run'; requestedAt: string; id: string } | { order: 'name'; folded: string; id: string };
export const suiteKeyColumns = [
  namespaceIdColumn,
  sqlTextColumn('folder_id', 45),
  sqlTextColumn('folded_name', 16384),
  sqlTextColumn('latest_run_id', 45, true),
  sqlTextColumn('latest_requested_at', 24),
  sqlTextColumn('latest_group', 16),
].join(',');
export function publicGroup(group: StoredGroup): SuiteGroup {
  return group === 'no_revision' ? 'no_runs' : group;
}
/** Every stored group the filters admit. A run group implies a current revision (engine k6). */
export function storedGroups(query: NormalizedSuiteListQuery): StoredGroup[] {
  return STORED_GROUPS.filter(
    (group) =>
      (query.group === undefined || publicGroup(group) === query.group) &&
      (query.engineId === undefined || group !== 'no_revision'),
  );
}
function stored(value: unknown): value is StoredGroup {
  return typeof value === 'string' && (STORED_GROUPS as readonly string[]).includes(value);
}
export function captureSuiteKey(input: unknown): SuiteKey {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new StorageError('unavailable');
  const row = input as Record<string, unknown>;
  const { id } = captureNamespaceId(row);
  if (typeof row.folded_name !== 'string' || !validateApi('Uuid', row.folder_id).ok || !latestValid(row))
    throw new StorageError('unavailable');
  return {
    id,
    folder_id: String(row.folder_id).toLowerCase(),
    folded_name: row.folded_name,
    latest_run_id: row.latest_run_id === null ? null : String(row.latest_run_id),
    latest_requested_at: String(row.latest_requested_at),
    latest_group: row.latest_group as StoredGroup,
  };
}
/** A run group carries a Run UUID and time; the empty groups carry neither. */
function latestValid(row: Record<string, unknown>): boolean {
  const group = row.latest_group;
  if (!stored(group)) return false;
  if (row.latest_run_id === null)
    return row.latest_requested_at === '' && !(RUN_GROUPS as readonly string[]).includes(group);
  return (
    validateApi('Uuid', row.latest_run_id).ok &&
    validateApi('RunTimestamp', row.latest_requested_at).ok &&
    (RUN_GROUPS as readonly string[]).includes(group)
  );
}
/** Total page order: recent_run is (requestedAt, id) descending; name is (UTF-8 folded name, id) ascending. */
export function compareSuiteKeys(order: NormalizedSuiteListQuery['order'], a: SuiteKey, b: SuiteKey): number {
  if (order === 'name') {
    const byName = Buffer.compare(Buffer.from(a.folded_name), Buffer.from(b.folded_name));
    return byName !== 0 ? byName : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }
  if (a.latest_requested_at !== b.latest_requested_at) return a.latest_requested_at > b.latest_requested_at ? -1 : 1;
  return a.id > b.id ? -1 : a.id < b.id ? 1 : 0;
}
export function follows(after: SuiteAfter | null, key: SuiteKey): boolean {
  if (after === null) return true;
  const base = { id: after.id, folder_id: '', latest_run_id: null, latest_group: 'no_runs' as const };
  const anchor: SuiteKey =
    after.order === 'name'
      ? { ...base, folded_name: after.folded, latest_requested_at: '' }
      : { ...base, folded_name: '', latest_requested_at: after.requestedAt };
  return compareSuiteKeys(after.order, anchor, key) < 0;
}
function index(folder: boolean, order: NormalizedSuiteListQuery['order']): string {
  return `suites_latest_${folder ? 'folder_' : ''}${order === 'name' ? 'name' : 'recent'}`;
}
/** One stored group, one equality prefix and an index-ordered keyset: no scan, no temp sort. */
export function suiteGroupStatement(
  scope: WorkspaceScope,
  query: NormalizedSuiteListQuery,
  group: StoredGroup,
  after: SuiteAfter | null,
): { sql: string; values: SQLInputValue[] } {
  const predicates = ['organization_id=?', 'workspace_id=?'];
  const values: SQLInputValue[] = [scope.organizationId, scope.workspaceId];
  if (query.folderId !== undefined) {
    predicates.push('folder_id=?');
    values.push(query.folderId);
  }
  predicates.push('latest_group=?');
  values.push(group);
  const name = query.order === 'name';
  if (after !== null) {
    predicates.push(name ? '(folded_name,id)>(?,?)' : '(latest_requested_at,id)<(?,?)');
    values.push(after.order === 'name' ? after.folded : after.requestedAt, after.id);
  }
  values.push(query.limit + 1);
  const order = name ? 'suites.folded_name,suites.id' : 'suites.latest_requested_at DESC,suites.id DESC';
  return {
    sql: `SELECT ${suiteKeyColumns} FROM suites INDEXED BY ${index(query.folderId !== undefined, query.order)}
 WHERE ${predicates.join(' AND ')} ORDER BY ${order} LIMIT ?`,
    values,
  };
}
export const suiteKeyByIdSql = `SELECT ${suiteKeyColumns} FROM suites WHERE organization_id=? AND workspace_id=? AND id=?`;
