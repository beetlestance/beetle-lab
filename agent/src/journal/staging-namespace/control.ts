import type { DatabaseSync } from 'node:sqlite';
import { cleanupControl } from '../../cleanup-control/index.js';
import { Failure, quotaUsed } from '../sql.js';
import type { Row } from '../sql.js';
function installedIdentity(db: DatabaseSync): string {
  const row = db.prepare("SELECT namespace_identity FROM installed_staging_namespace WHERE id=1 AND state='bound'").get();
  if (typeof row?.namespace_identity !== 'string') throw new Failure('recovery_required');
  return row.namespace_identity;
}
export function assertCleanupControl(db: DatabaseSync, row: Row): void {
  if (row.cleanup_control_version !== cleanupControl.version || row.cleanup_control_bytes !== cleanupControl.reservedBytes || row.staging_namespace_identity !== installedIdentity(db)) throw new Failure('recovery_required');
}
/** Caller transaction owns reservation/event insertion; failures roll the reserve back too. */
export function reserveCleanupControl(db: DatabaseSync, row: Row, holdBytes: number): void {
  const namespace = installedIdentity(db);
  if (row.cleanup_control_version === 0 && row.cleanup_control_bytes === 0 && row.staging_namespace_identity !== null) throw new Failure('recovery_required');
  if (row.cleanup_control_version !== 0 || row.cleanup_control_bytes !== 0) { assertCleanupControl(db, row); return; }
  if (quotaUsed(row, { cleanup_control_bytes: cleanupControl.reservedBytes, hold_bytes: holdBytes }) > row.quota_bytes) throw new Failure('quota_exceeded');
  db.prepare('UPDATE accepted_attempts SET cleanup_control_version=1,cleanup_control_bytes=?,staging_namespace_identity=? WHERE attempt_id=?')
    .run(cleanupControl.reservedBytes, namespace, row.attempt_id);
}
