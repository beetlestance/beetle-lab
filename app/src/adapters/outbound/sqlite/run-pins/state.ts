import type { DatabaseSync } from 'node:sqlite';
import type { WorkspaceScope } from '@beetle/contracts/api';
import { StorageError } from '../protocol.js';
import { RUN_PIN_LIMIT } from '../migration033.js';

/** Scoped pin time, or null. One primary-key lookup; no unscoped pin is ever visible. */
export function runPinnedAt(db: DatabaseSync, scope: WorkspaceScope, runId: string): string | null {
  const row = db
    .prepare('SELECT pinned_at FROM run_pins WHERE run_id=? AND organization_id=? AND workspace_id=?')
    .get(runId.toLowerCase(), scope.organizationId.toLowerCase(), scope.workspaceId.toLowerCase());
  if (row === undefined) return null;
  if (typeof row.pinned_at !== 'string' || row.pinned_at.length !== 24) throw new StorageError('unavailable');
  return row.pinned_at;
}
/** Removal admission recheck, independent of any preview epoch. */
export function requireUnpinned(db: DatabaseSync, runId: string): void {
  if (db.prepare('SELECT 1 FROM run_pins WHERE run_id=? LIMIT 1').get(runId.toLowerCase()))
    throw new StorageError('run_pinned');
}
/** Bounded by the per-workspace limit. */
export function workspacePinCount(db: DatabaseSync, scope: WorkspaceScope): number {
  const row = db
    .prepare(
      `SELECT count(*) count FROM (SELECT 1 FROM run_pins INDEXED BY run_pins_workspace
       WHERE organization_id=? AND workspace_id=? LIMIT ${RUN_PIN_LIMIT + 1})`,
    )
    .get(scope.organizationId.toLowerCase(), scope.workspaceId.toLowerCase());
  if (typeof row?.count !== 'number') throw new StorageError('unavailable');
  return row.count;
}
/** SQL fragment for list filters: at most 256 pinned run IDs per workspace. */
export const pinnedRunsSql =
  'SELECT run_id FROM run_pins INDEXED BY run_pins_workspace WHERE organization_id=? AND workspace_id=?';
