import type { DatabaseSync } from 'node:sqlite';
import { StorageError } from '../protocol.js';
import { sha256 } from '../input-values.js';
import type { ReclaimPosition } from './cursor.js';
/**
 * A Run is offered to Begin only when backend settlement can later purge it: terminal, unpinned
 * (pins keep protecting after retirement, decision 034), no retained note, exactly one attempt
 * and no export job bound to that attempt or its queue order. Every predicate is an indexed probe.
 */
export const reclaimableSql = `r.state IN ('finished','cancelled','errored') AND r.outcome!='pending'
 AND NOT EXISTS(SELECT 1 FROM output_deletion_intents d WHERE d.run_id=r.id)
 AND NOT EXISTS(SELECT 1 FROM run_pins p WHERE p.run_id=r.id)
 AND NOT EXISTS(SELECT 1 FROM run_notes n WHERE n.run_id=r.id)
 AND (SELECT count(*) FROM (SELECT 1 FROM attempts a WHERE a.run_id=r.id LIMIT 2))=1
 AND NOT EXISTS(SELECT 1 FROM export_jobs x WHERE x.attempt_id=r.active_attempt_id)
 AND NOT EXISTS(SELECT 1 FROM execution_orders o JOIN export_jobs x ON x.queue_order=o.queue_order
  WHERE o.attempt_id=r.active_attempt_id)`;
export interface ReclaimRow {
  readonly id: string;
  readonly version: number;
  readonly open: boolean;
}
export interface WorkspaceRow {
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly retired: boolean;
}
/** One indexed keyset step; live workspaces are read and skipped, never inspected further. */
export function nextWorkspace(db: DatabaseSync, after: ReclaimPosition): WorkspaceRow | null {
  const row = db
    .prepare(
      `SELECT organization_id,id,retired FROM workspaces INDEXED BY workspaces_page
   WHERE (organization_id,id)>(?,?) ORDER BY organization_id,id LIMIT 1`,
    )
    .get(after.organizationId, after.workspaceId);
  if (!row) return null;
  if (typeof row.organization_id !== 'string' || typeof row.id !== 'string' || ![0, 1].includes(Number(row.retired)))
    throw new StorageError('unavailable');
  return { organizationId: row.organization_id, workspaceId: row.id, retired: row.retired === 1 };
}
/** At most `limit` Run headers of one retired workspace after the cursor Run. */
export function retiredRuns(db: DatabaseSync, at: ReclaimPosition, limit: number): readonly ReclaimRow[] {
  const rows = db
    .prepare(
      `SELECT r.id,r.version,(${reclaimableSql}) open FROM runs r INDEXED BY runs_page
   WHERE r.organization_id=? AND r.workspace_id=? AND r.id>? ORDER BY r.id LIMIT ?`,
    )
    .all(at.organizationId, at.workspaceId, at.runId, limit);
  return rows.map((row) => {
    if (typeof row.id !== 'string' || !Number.isSafeInteger(row.version) || ![0, 1].includes(Number(row.open)))
      throw new StorageError('unavailable');
    return { id: row.id, version: row.version as number, open: row.open === 1 };
  });
}
/** Deterministic per-Run identities: a lost reply replays the same Begin, and run_id stays unique. */
export function reclaimIdentity(kind: 'deletion' | 'request', runId: string): string {
  const hex = sha256(`beetle-lab.retired-reclaim.${kind}.v1\n${runId}`);
  const variant = ((Number.parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
