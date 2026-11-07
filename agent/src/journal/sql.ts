import type { DatabaseSync } from 'node:sqlite';
import type { AttemptSnapshot } from '@beetle/contracts';
import type { AttemptKey, ErrorCode } from './protocol.js';

export interface Row {
  id: number; attempt_id: string; organization_id: string; workspace_id: string;
  intent_digest: string; generation: number; state: AttemptSnapshot['state']; last_seq: number;
  cancel_requested: number; retained_start_seq: number; acknowledged_seq: number;
  spool_bytes: number; spool_rows: number; quota_bytes: number;
  wrapper_high: number; supervisor_high: number;
  wrapper_expired: number; supervisor_expired: number;
}
export const columns = `id, attempt_id, organization_id, workspace_id, intent_digest, generation,
  state, last_seq, cancel_requested, retained_start_seq, acknowledged_seq, spool_bytes,
  spool_rows, quota_bytes, wrapper_high, supervisor_high, wrapper_expired, supervisor_expired`;
export class Failure extends Error {
  constructor(readonly code: ErrorCode, readonly recovery?: AttemptSnapshot) { super(code); }
}
export function snapshot(row: Row): AttemptSnapshot {
  return { protocolVersion: '1.0', attemptId: row.attempt_id, organizationId: row.organization_id,
    workspaceId: row.workspace_id, intentDigest: row.intent_digest, generation: row.generation,
    state: row.state, lastSeq: row.last_seq, retainedStartSeq: row.retained_start_seq,
    cancelRequested: row.cancel_requested === 1 };
}
export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const value = work(); db.exec('COMMIT'); return value; }
  catch (error) {
    try { db.exec('ROLLBACK'); } catch { throw new Failure('unavailable'); }
    throw error;
  }
}
export function owner(db: DatabaseSync, key: AttemptKey & { generation?: number }): Row {
  const row = db.prepare(`SELECT ${columns} FROM accepted_attempts
    WHERE attempt_id=? AND organization_id=? AND workspace_id=?`)
    .get(key.attemptId, key.organizationId, key.workspaceId) as unknown as Row | undefined;
  if (!row) throw new Failure('not_found');
  if (key.generation !== undefined && row.generation !== key.generation) throw new Failure('stale_generation');
  return row;
}
