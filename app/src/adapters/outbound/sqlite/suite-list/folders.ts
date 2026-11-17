import type { DatabaseSync } from 'node:sqlite';
import { SUITE_GROUPS } from '@beetle/contracts/api';
import type { FolderSummary, SuiteGroup, WorkspaceScope } from '@beetle/contracts/api';
import { sqlIntegerColumn, sqlTextColumn } from '../sql-columns.js';
import { StorageError } from '../protocol.js';
import { latestRunHeader } from './latest-run.js';
import { captureSuiteKey, compareSuiteKeys, publicGroup, suiteKeyColumns } from './statements.js';
import type { SuiteKey } from './statements.js';

const owner = 'organization_id=? AND workspace_id=?';
/** Direct suites per stored group, read from the folder group index (no table rows). */
export const folderGroupCountSql = `SELECT ${sqlTextColumn('latest_group', 16)},${sqlIntegerColumn('n')} FROM
 (SELECT latest_group,count(*) AS n FROM suites INDEXED BY suites_latest_folder_recent
 WHERE ${owner} AND folder_id=? GROUP BY latest_group)`;
export const subfolderCountSql = `SELECT ${sqlIntegerColumn('n')} FROM (SELECT count(*) AS n FROM folders
 INDEXED BY folders_children WHERE ${owner} AND parent_id=?)`;
/** Newest latest Run of one run group in one folder: a single index seek. */
export const folderNewestSql = `SELECT ${suiteKeyColumns} FROM suites INDEXED BY suites_latest_folder_recent
 WHERE ${owner} AND folder_id=? AND latest_group=? ORDER BY suites.latest_requested_at DESC,suites.id DESC LIMIT 1`;
const RUN_GROUPS = SUITE_GROUPS.filter((group) => group !== 'no_runs');

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new StorageError('unavailable');
  return value;
}
function groups(db: DatabaseSync, scope: WorkspaceScope, folderId: string): Record<SuiteGroup, number> {
  const result = Object.fromEntries(SUITE_GROUPS.map((group) => [group, 0])) as Record<SuiteGroup, number>;
  for (const row of db.prepare(folderGroupCountSql).all(scope.organizationId, scope.workspaceId, folderId)) {
    const group = row.latest_group === 'no_revision' ? publicGroup('no_revision') : row.latest_group;
    if (typeof group !== 'string' || !(SUITE_GROUPS as readonly string[]).includes(group))
      throw new StorageError('unavailable');
    result[group as SuiteGroup] += count(row.n);
  }
  return result;
}
function newest(db: DatabaseSync, scope: WorkspaceScope, folderId: string): SuiteKey | null {
  let best: SuiteKey | null = null;
  for (const group of RUN_GROUPS) {
    const row = db.prepare(folderNewestSql).get(scope.organizationId, scope.workspaceId, folderId, group);
    if (row === undefined) continue;
    const key = captureSuiteKey(row);
    if (best === null || compareSuiteKeys('recent_run', key, best) < 0) best = key;
  }
  return best;
}
/** One summary per listed folder; the caller holds the read transaction that produced the items. */
export function folderSummaries(
  db: DatabaseSync,
  scope: WorkspaceScope,
  folderIds: readonly string[],
): FolderSummary[] {
  return folderIds.map((folderId) => {
    const counts = groups(db, scope, folderId);
    const subfolders = db.prepare(subfolderCountSql).get(scope.organizationId, scope.workspaceId, folderId);
    const latest = newest(db, scope, folderId);
    return {
      folderId,
      suiteCount: SUITE_GROUPS.reduce((sum, group) => sum + counts[group], 0),
      subfolderCount: count(subfolders?.n),
      groups: counts,
      latestRun: latest === null ? null : latestRunHeader(db, scope, latest),
    };
  });
}
