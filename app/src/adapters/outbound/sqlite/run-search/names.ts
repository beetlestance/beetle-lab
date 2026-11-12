import type { DatabaseSync } from 'node:sqlite';
import { foldRunSearchName, runSearchTerms } from '@beetle/contracts/api';
import type { WorkspaceScope } from '@beetle/contracts/api';
import { StorageError } from '../protocol.js';
interface Candidate { kind: 'suite' | 'folder'; entity_id: string }
const budget = 256;
export function workspaceNameMatches(db: DatabaseSync, scope: WorkspaceScope, name: string): boolean {
  const row = db.prepare('SELECT folded_name FROM workspaces WHERE organization_id=? AND id=?')
    .get(scope.organizationId, scope.workspaceId) as { folded_name: string } | undefined;
  if (!row) throw new StorageError('not_found');
  return foldRunSearchName(row.folded_name).includes(name);
}
/** Select a complete bounded posting, then verify the entire literal against current names. */
function candidates(db: DatabaseSync, scope: WorkspaceScope, name: string): Candidate[] {
  for (const term of runSearchTerms(name)) {
    const rows = db.prepare(`SELECT kind,entity_id FROM history_name_grams
      WHERE organization_id=? AND workspace_id=? AND term=? ORDER BY kind,entity_id LIMIT ?`)
      .all(scope.organizationId, scope.workspaceId, term, budget + 1) as unknown as Candidate[];
    if (rows.length > budget) continue;
    return rows.filter(row => {
      const table = row.kind === 'suite' ? 'suites' : 'folders';
      const current = db.prepare(`SELECT folded_name FROM ${table} WHERE organization_id=? AND workspace_id=? AND id=?`)
        .get(scope.organizationId, scope.workspaceId, row.entity_id) as { folded_name: string } | undefined;
      return current !== undefined && foldRunSearchName(current.folded_name).includes(name);
    });
  }
  throw new StorageError('search_too_broad');
}
function addBounded(set: Set<string>, ids: readonly string[]): void {
  for (const id of ids) { set.add(id); if (set.size > budget) throw new StorageError('search_too_broad'); }
}
/** Current folder ancestry expands through covering indexes; no denormalized Run paths. */
export function matchingSuites(db: DatabaseSync, scope: WorkspaceScope, name: string): string[] {
  const matched = candidates(db, scope, name);
  const suites = new Set(matched.filter(row => row.kind === 'suite').map(row => row.entity_id));
  const folders = new Set(matched.filter(row => row.kind === 'folder').map(row => row.entity_id));
  const queue = [...folders];
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head]!;
    const children = db.prepare(`SELECT id FROM folders INDEXED BY folders_children
      WHERE organization_id=? AND workspace_id=? AND parent_id=? ORDER BY id LIMIT ?`)
      .all(scope.organizationId, scope.workspaceId, id, budget + 1) as unknown as { id: string }[];
    const old = new Set(folders);
    addBounded(folders, children.map(row => row.id));
    queue.push(...children.filter(row => !old.has(row.id)).map(row => row.id));
    const contained = db.prepare(`SELECT id FROM suites INDEXED BY suites_history_folder
      WHERE organization_id=? AND workspace_id=? AND folder_id=? ORDER BY id LIMIT ?`)
      .all(scope.organizationId, scope.workspaceId, id, budget + 1) as unknown as { id: string }[];
    addBounded(suites, contained.map(row => row.id));
  }
  return [...suites];
}
