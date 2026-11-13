import type { DatabaseSync } from 'node:sqlite';
import type { WorkspaceScope } from '@beetle/contracts/api';
import { StorageError } from '../protocol.js';
import { transaction } from '../transaction.js';
interface Progress { folder_after: string; suite_after: string; folders_done: number; suites_done: number }
/** One request advances at most16 documents, with durable checkpoints and no startup walk. */
export function prepareNameSearch(db: DatabaseSync, scope: WorkspaceScope): void {
  const ready = transaction(db, () => {
    db.prepare('INSERT OR IGNORE INTO history_name_progress(organization_id,workspace_id) VALUES(?,?)')
      .run(scope.organizationId, scope.workspaceId);
    const progress = db.prepare('SELECT * FROM history_name_progress WHERE organization_id=? AND workspace_id=?')
      .get(scope.organizationId, scope.workspaceId) as unknown as Progress;
    let remaining = 16;
    for (const kind of ['folder', 'suite'] as const) {
      if (progress[`${kind}s_done`] || remaining === 0) continue;
      const batch = backfill(db, scope, kind, progress[`${kind}_after`], remaining);
      remaining -= batch.count;
      progress[`${kind}_after`] = batch.after;
      progress[`${kind}s_done`] = batch.done ? 1 : 0;
    }
    db.prepare(`UPDATE history_name_progress SET folder_after=?,suite_after=?,folders_done=?,suites_done=?
      WHERE organization_id=? AND workspace_id=?`).run(progress.folder_after, progress.suite_after,
        progress.folders_done, progress.suites_done, scope.organizationId, scope.workspaceId);
    return progress.folders_done === 1 && progress.suites_done === 1;
  });
  if (!ready) throw new StorageError('search_indexing');
}
function backfill(db: DatabaseSync, scope: WorkspaceScope, kind: 'folder' | 'suite', after: string, limit: number) {
  const table = kind === 'folder' ? 'folders' : 'suites';
  const rows = db.prepare(`SELECT id,folded_name FROM ${table} WHERE organization_id=? AND workspace_id=? AND id>? ORDER BY id LIMIT ?`)
    .all(scope.organizationId, scope.workspaceId, after, limit + 1) as unknown as { id: string; folded_name: string }[];
  for (const row of rows.slice(0, limit)) {
    db.prepare(`INSERT OR IGNORE INTO history_name_grams
      SELECT ?,?,?,?,value FROM json_each(history_search_terms(?))`)
      .run(scope.organizationId, scope.workspaceId, kind, row.id, row.folded_name);
  }
  return { count: Math.min(limit, rows.length), after: rows.slice(0, limit).at(-1)?.id ?? after, done: rows.length <= limit };
}
