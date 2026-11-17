import { captureSearchCandidate, captureSearchDocument, captureSearchName, documentColumns } from './rows.js';
import type { SearchCandidate as Candidate } from './rows.js';
import { captureNamespaceId, namespaceIdColumn } from '../namespace-rows.js';
import { sqlTextColumn } from '../sql-columns.js';
import type { DatabaseSync } from 'node:sqlite';
import { foldRunSearchName, runSearchTerms } from '@beetle/contracts/api';
import type { WorkspaceScope } from '@beetle/contracts/api';
import { StorageError } from '../protocol.js';
const budget = 256;
export function workspaceNameMatches(db: DatabaseSync, scope: WorkspaceScope, name: string): boolean {
  const row = db
    .prepare(`SELECT ${sqlTextColumn('name', 512)} FROM workspaces WHERE organization_id=? AND id=?`)
    .get(scope.organizationId, scope.workspaceId);
  if (!row) throw new StorageError('not_found');
  return foldRunSearchName(captureSearchName(row.name)).includes(name);
}
/** Select a complete bounded posting, then verify the entire literal against current names. */
function candidates(db: DatabaseSync, scope: WorkspaceScope, name: string, suitesOnly = false): Candidate[] {
  for (const term of runSearchTerms(name)) {
    const rows = db
      .prepare(
        `SELECT ${sqlTextColumn('kind', 8)},${sqlTextColumn('entity_id', 45)} FROM history_name_grams
      WHERE organization_id=? AND workspace_id=? AND term=? ${suitesOnly ? "AND kind='suite'" : ''}
      ORDER BY history_name_grams.kind,history_name_grams.entity_id LIMIT ?`,
      )
      .all(scope.organizationId, scope.workspaceId, term, budget + 1)
      .map(captureSearchCandidate);
    if (rows.length > budget) continue;
    return rows.filter((row) => {
      const table = row.kind === 'suite' ? 'suites' : 'folders';
      const current = db
        .prepare(`SELECT ${documentColumns} FROM ${table} WHERE organization_id=? AND workspace_id=? AND id=?`)
        .get(scope.organizationId, scope.workspaceId, row.entity_id);
      return current !== undefined && foldRunSearchName(captureSearchDocument(current).folded_name).includes(name);
    });
  }
  throw new StorageError('search_too_broad');
}
/** Suite-name-only search: same postings, folding and budget; folder names never match. */
export function matchingSuiteNames(db: DatabaseSync, scope: WorkspaceScope, name: string): string[] {
  return candidates(db, scope, name, true).map((row) => row.entity_id);
}
function addBounded(set: Set<string>, ids: readonly string[]): void {
  for (const id of ids) {
    set.add(id);
    if (set.size > budget) throw new StorageError('search_too_broad');
  }
}
/** Current folder ancestry expands through covering indexes; no denormalized Run paths. */
export function matchingSuites(db: DatabaseSync, scope: WorkspaceScope, name: string): string[] {
  const matched = candidates(db, scope, name);
  const suites = new Set(matched.filter((row) => row.kind === 'suite').map((row) => row.entity_id));
  const folders = new Set(matched.filter((row) => row.kind === 'folder').map((row) => row.entity_id));
  const queue = [...folders];
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head]!;
    const children = db
      .prepare(
        `SELECT ${namespaceIdColumn} FROM folders INDEXED BY folders_children
      WHERE organization_id=? AND workspace_id=? AND parent_id=? ORDER BY folders.id LIMIT ?`,
      )
      .all(scope.organizationId, scope.workspaceId, id, budget + 1)
      .map(captureNamespaceId);
    const old = new Set(folders);
    addBounded(
      folders,
      children.map((row) => row.id),
    );
    queue.push(...children.filter((row) => !old.has(row.id)).map((row) => row.id));
    const contained = db
      .prepare(
        `SELECT ${namespaceIdColumn} FROM suites INDEXED BY suites_history_folder
      WHERE organization_id=? AND workspace_id=? AND folder_id=? ORDER BY suites.id LIMIT ?`,
      )
      .all(scope.organizationId, scope.workspaceId, id, budget + 1)
      .map(captureNamespaceId);
    addBounded(
      suites,
      contained.map((row) => row.id),
    );
  }
  return [...suites];
}
