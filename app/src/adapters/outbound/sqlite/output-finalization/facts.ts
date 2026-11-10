import type { DatabaseSync } from 'node:sqlite';
import { validate } from '@beetle/contracts';
import type { EventBinding } from '../../../../ports/events.js';
import { StorageError } from '../protocol.js';
export function requireCurrentRun(db: DatabaseSync, binding: EventBinding, version: number): void {
  const { key } = binding; const a = key.attempt;
  const run = db.prepare('SELECT active_attempt_id,version,state FROM runs WHERE id=? AND organization_id=? AND workspace_id=?')
    .get(key.runId, a.organizationId, a.workspaceId);
  if (!run) throw new StorageError('not_found');
  if (run.active_attempt_id !== a.attemptId || run.version !== version
    || !['queued', 'dispatching', 'active', 'finalizing'].includes(String(run.state))) throw new StorageError('conflict');
}
/** Returns false for an older header; a header beyond the immutable end conflicts. */
export function checkFinalHeader(db: DatabaseSync, attempt: string, end: number): boolean {
  const row = db.prepare(`SELECT CASE WHEN length(CAST(snapshot_json AS BLOB))<=2048 THEN snapshot_json ELSE NULL END header
    FROM execution_records WHERE attempt_id=?`).get(attempt);
  if (!row || typeof row.header !== 'string') throw new StorageError('unavailable');
  const header = validate('AttemptSnapshot', JSON.parse(row.header) as unknown);
  if (!header.ok) throw new StorageError('unavailable');
  if (header.value.lastSeq > end) throw new StorageError('conflict');
  return header.value.lastSeq === end;
}
export function seedZeroCursor(db: DatabaseSync, binding: EventBinding): void {
  const { key, journalAuthority } = binding; const a = key.attempt;
  if (db.prepare('SELECT attempt_id FROM event_cursors WHERE attempt_id=?').get(a.attemptId)) return;
  db.prepare(`INSERT INTO event_cursors(attempt_id,run_id,organization_id,workspace_id,intent_digest,journal_authority,generation)
    VALUES(?,?,?,?,?,?,1)`).run(a.attemptId, key.runId, a.organizationId, a.workspaceId, a.intentDigest, journalAuthority);
}
export const finalEventsReady = (end: string) => `c.durable_through=${end} AND c.event_count=${end}
 AND c.ack_confirmed_through=${end} AND c.coverage='contiguous' AND c.blocked_reason IS NULL
 AND coalesce((SELECT max(seq) FROM run_events WHERE attempt_id=e.attempt_id AND generation=1),0)=${end}
 AND coalesce((SELECT cumulative_bytes FROM run_events WHERE attempt_id=e.attempt_id AND generation=1 AND seq=${end}),0)=c.retained_bytes`;
export const releasedHeader = `e.execution_charged=0 AND length(CAST(e.snapshot_json AS BLOB))<=2048
 AND json_type(e.snapshot_json,'$.result') IS NULL`;
export function requireRetention(retained: unknown, maximum: unknown): void {
  if (typeof retained !== 'number' || !Number.isSafeInteger(retained) || retained < 0
    || typeof maximum !== 'number' || !Number.isSafeInteger(maximum) || retained > maximum) throw new StorageError('unavailable');
}
