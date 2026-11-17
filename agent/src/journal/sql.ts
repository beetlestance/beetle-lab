export {
  columns,
  metadataColumns,
  executionPurposeColumn,
  cleanupControlColumns,
  exportResultColumn,
} from './legacy-columns.js';
import { sqlTextColumn, sqlIntegerColumn } from './sql-columns.js';
import { captureAttemptRow } from './attempt-row.js';
import type { Row } from './attempt-row.js';
import { Failure } from './failure.js';
import type { DatabaseSync } from 'node:sqlite';
import type { AttemptKey } from './protocol.js';

export { Failure } from './failure.js';
export type { Row } from './attempt-row.js';
export { snapshot } from './attempt-row.js';
const metadataNumbers = [
  'id',
  'generation',
  'last_seq',
  'cancel_requested',
  'retained_start_seq',
  'acknowledged_seq',
  'spool_bytes',
  'spool_rows',
  'quota_bytes',
  'wrapper_high',
  'supervisor_high',
  'wrapper_expired',
  'supervisor_expired',
  'snapshot_bytes',
  'checkpoint_bytes',
];
const servingExecutionPurposeColumn = sqlTextColumn('execution_purpose', 32);
const servingCleanupControlColumns = [
  sqlIntegerColumn('cleanup_control_version'),
  sqlIntegerColumn('cleanup_control_bytes'),
  sqlTextColumn('staging_namespace_identity', 64, true),
].join(',');
const servingMetadataColumns = [
  ...metadataNumbers.map((name) => sqlIntegerColumn(name)),
  sqlTextColumn('attempt_id', 45),
  sqlTextColumn('organization_id', 45),
  sqlTextColumn('workspace_id', 45),
  sqlTextColumn('intent_digest', 64),
  sqlTextColumn('state', 64),
  sqlTextColumn('phase', 32, true),
  sqlTextColumn('exit_json', 1024, true),
].join(',');
const servingExportResultColumn = sqlTextColumn('export_result_json', 8192, true);
const scalars = [
  servingMetadataColumns,
  servingExecutionPurposeColumn,
  servingCleanupControlColumns,
  ...[
    'hold_bytes',
    'collection_bytes',
    'source_bytes',
    'delivery_bytes',
    'delivery_pending',
    'absence_bytes',
    'absence_pending',
  ].map((name) => sqlIntegerColumn(name)),
].join(',');
export const servingColumns = [
  scalars,
  servingExportResultColumn,
  sqlTextColumn('result_json', 65536, true),
  sqlTextColumn('exit_facts_json', 1024, true),
  sqlTextColumn('wrapper_checkpoint_json', 1024, true),
].join(',');
export const listColumns = [
  scalars,
  'NULL AS result_json',
  'NULL AS export_result_json',
  'NULL AS exit_facts_json',
  'NULL AS wrapper_checkpoint_json',
].join(',');
type Charges = Pick<
  Row,
  | 'spool_bytes'
  | 'snapshot_bytes'
  | 'checkpoint_bytes'
  | 'hold_bytes'
  | 'collection_bytes'
  | 'source_bytes'
  | 'delivery_bytes'
  | 'absence_bytes'
  | 'cleanup_control_bytes'
>;
export function quotaUsed(row: Charges, replace: Partial<Charges> = {}): number {
  let total = 0;
  for (const name of [
    'spool_bytes',
    'snapshot_bytes',
    'checkpoint_bytes',
    'hold_bytes',
    'collection_bytes',
    'source_bytes',
    'delivery_bytes',
    'absence_bytes',
    'cleanup_control_bytes',
  ] as const) {
    const value = replace[name] === undefined ? row[name] : replace[name];
    if (!Number.isSafeInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER - total)
      throw new Failure('unavailable');
    total += value;
  }
  return total;
}
export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = work();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      throw new Failure('unavailable');
    }
    throw error;
  }
}
export function owner(db: DatabaseSync, key: AttemptKey & { generation?: number }): Row {
  const row = db
    .prepare(
      `SELECT ${servingColumns} FROM accepted_attempts
    WHERE attempt_id=? AND organization_id=? AND workspace_id=?`,
    )
    .get(key.attemptId, key.organizationId, key.workspaceId);
  if (!row) {
    if (db.prepare('SELECT 1 FROM retired_attempts WHERE attempt_id=?').get(key.attemptId))
      throw new Failure('conflict');
    throw new Failure('not_found');
  }
  const captured = captureAttemptRow(row);
  if (key.generation !== undefined && captured.generation !== key.generation) throw new Failure('stale_generation');
  return captured;
}
