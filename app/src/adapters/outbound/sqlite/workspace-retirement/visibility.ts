import type { DatabaseSync } from 'node:sqlite';
import type { WorkspaceScope } from '@beetle/contracts/api';
import { StorageError } from '../protocol.js';
import { lower } from '../input-values.js';
import { isHistorical } from '../historical.js';
/** Older real schema fixtures have no retired field; serving connections always migrate first.
 * Public visibility only. Private maintenance keeps its original retained lookup authority. */
export function requireVisibleWorkspace(db: DatabaseSync, scope: WorkspaceScope): void {
  if (isHistorical(db)) return;
  const row = db
    .prepare('SELECT * FROM workspaces WHERE organization_id=? AND id=?')
    .get(lower(scope.organizationId), lower(scope.workspaceId));
  if (!row || (row.retired !== undefined && row.retired !== 0)) throw new StorageError('not_found');
}
/** Fixed indexed predicates; retained output/history is deliberately absent. */
export const workspaceBusySql = [
  "EXISTS(SELECT 1 FROM runs WHERE organization_id=target.organization_id AND workspace_id=target.id AND state IN ('queued','dispatching','active','finalizing') LIMIT 1)",
  'EXISTS(SELECT 1 FROM execution_records INDEXED BY execution_workspace_busy WHERE organization_id=target.organization_id AND workspace_id=target.id AND execution_charged=1 LIMIT 1)',
  "EXISTS(SELECT 1 FROM export_jobs INDEXED BY exports_workspace_busy WHERE organization_id=target.organization_id AND workspace_id=target.id AND (state NOT IN ('ready','failed','cancelled') OR execution_charged=1) LIMIT 1)",
  "EXISTS(SELECT 1 FROM input_blobs INDEXED BY inputs_workspace_busy WHERE organization_id=target.organization_id AND workspace_id=target.id AND state IN ('staging','publishing','deleting') LIMIT 1)",
].join(' OR ');
export function requireRetirableWorkspace(db: DatabaseSync, id: string): void {
  const row = db
    .prepare(`SELECT retired,(${workspaceBusySql}) busy FROM workspaces target WHERE target.id=?`)
    .get(lower(id));
  if (!row || row.retired !== 0) throw new StorageError('not_found');
  if (row.busy !== 0) throw new StorageError('conflict');
}
/** Public organisation visibility; historical read-only mode keeps retired organisations readable. */
export function requireVisibleOrganization(db: DatabaseSync, organizationId: string): void {
  if (isHistorical(db)) return;
  const row = db.prepare('SELECT * FROM organizations WHERE id=?').get(lower(organizationId));
  if (!row || (row.retired !== undefined && row.retired !== 0)) throw new StorageError('not_found');
}
/** Organisation DELETE is allowed once every workspace is retired; rows are then retained (migration 030). */
export function requireRetirableOrganization(db: DatabaseSync, id: string): void {
  const row = db
    .prepare(
      `SELECT retired,EXISTS(SELECT 1 FROM workspaces INDEXED BY workspaces_visible
       WHERE retired=0 AND organization_id=target.id LIMIT 1) active FROM organizations target WHERE target.id=?`,
    )
    .get(lower(id));
  if (!row || row.retired !== 0) throw new StorageError('not_found');
  if (row.active !== 0) throw new StorageError('organization_has_active_workspaces');
}
