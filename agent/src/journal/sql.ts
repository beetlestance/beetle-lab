import type { DatabaseSync } from 'node:sqlite';
import type { AttemptSnapshot } from '@beetle/contracts';
import type { AttemptKey, ErrorCode } from './protocol.js';

export interface Row {
  id: number; attempt_id: string; organization_id: string; workspace_id: string;
  intent_digest: string; execution_purpose: 'performance'|'standalone_export'; generation: number; state: AttemptSnapshot['state']; last_seq: number;
  cancel_requested: number; retained_start_seq: number; acknowledged_seq: number;
  spool_bytes: number; spool_rows: number; quota_bytes: number; hold_bytes: number; collection_bytes: number; source_bytes: number;
  delivery_bytes: number; delivery_pending: number;
  absence_bytes: number; absence_pending: number;
  cleanup_control_version: number; cleanup_control_bytes: number; staging_namespace_identity: string | null;
  wrapper_high: number; supervisor_high: number;
  wrapper_expired: number; supervisor_expired: number;
  checkpoint_bytes: number; wrapper_checkpoint_json: string | null;
  phase: NonNullable<AttemptSnapshot['phase']> | null;
  exit_json: string | null; exit_facts_json: string | null; result_json: string | null; export_result_json: string | null; snapshot_bytes: number;
}
export const executionPurposeColumn='execution_purpose';
export const cleanupControlColumns='cleanup_control_version, cleanup_control_bytes, staging_namespace_identity';
export const metadataColumns = `id, attempt_id, organization_id, workspace_id, intent_digest, generation,
  state, last_seq, cancel_requested, retained_start_seq, acknowledged_seq, spool_bytes,
  spool_rows, quota_bytes, wrapper_high, supervisor_high, wrapper_expired, supervisor_expired,
  phase, exit_json, snapshot_bytes, checkpoint_bytes`;
export const exportResultColumn = `CASE WHEN length(CAST(export_result_json AS BLOB))<=8192 THEN export_result_json ELSE NULL END AS export_result_json`;
export const columns = `${metadataColumns}, ${executionPurposeColumn}, hold_bytes, collection_bytes, source_bytes, delivery_bytes, delivery_pending, absence_bytes, absence_pending, ${cleanupControlColumns},
  ${exportResultColumn},
  CASE WHEN length(CAST(result_json AS BLOB))<=65536 THEN result_json ELSE NULL END AS result_json,
  CASE WHEN length(CAST(exit_facts_json AS BLOB))<=1024 THEN exit_facts_json ELSE NULL END AS exit_facts_json,
  CASE WHEN length(CAST(wrapper_checkpoint_json AS BLOB))<=1024 THEN wrapper_checkpoint_json ELSE NULL END AS wrapper_checkpoint_json`;
export class Failure extends Error {
  constructor(readonly code: ErrorCode, readonly recovery?: AttemptSnapshot) { super(code); }
}
type Charges = Pick<Row, 'spool_bytes' | 'snapshot_bytes' | 'checkpoint_bytes' | 'hold_bytes' | 'collection_bytes' | 'source_bytes' | 'delivery_bytes' | 'absence_bytes' | 'cleanup_control_bytes'>;
export function quotaUsed(row: Charges, replace: Partial<Charges> = {}): number {
  let total = 0;
  for (const name of ['spool_bytes', 'snapshot_bytes', 'checkpoint_bytes', 'hold_bytes', 'collection_bytes', 'source_bytes', 'delivery_bytes', 'absence_bytes', 'cleanup_control_bytes'] as const) {
    const value = replace[name] === undefined ? row[name] : replace[name];
    if (!Number.isSafeInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER - total) throw new Failure('unavailable');
    total += value;
  }
  return total;
}
export function snapshot(row: Row): AttemptSnapshot {
  return { protocolVersion: '1.0', attemptId: row.attempt_id, organizationId: row.organization_id,
    workspaceId: row.workspace_id, intentDigest: row.intent_digest, generation: row.generation,
    state: row.state, lastSeq: row.last_seq, retainedStartSeq: row.retained_start_seq,
    cancelRequested: row.cancel_requested === 1,
    ...(row.phase === null ? {} : { phase: row.phase }),
    ...(row.exit_json === null ? {} : { exitEvidence: JSON.parse(row.exit_json) }),
    ...(row.export_result_json == null ? {} : {exportResult: JSON.parse(row.export_result_json)}),
    ...(row.result_json === null ? {} : { result: JSON.parse(row.result_json) }) };
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
  if(!row){if(db.prepare('SELECT 1 FROM retired_attempts WHERE attempt_id=?').get(key.attemptId))throw new Failure('conflict');throw new Failure('not_found');}
  if (key.generation !== undefined && row.generation !== key.generation) throw new Failure('stale_generation');
  return row;
}
