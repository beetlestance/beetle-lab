import type { DatabaseSync } from 'node:sqlite';
import { DISK_HOLD_LIMIT } from '../admission/index.js';
import { absenceTables, absenceParentGuards, absenceGuards, absenceFences, absenceDebt } from './output-absence-schema.js';
import { absenceFacts, absencePending } from './output-absence-facts.js';
import { admissionSnapshot } from './admission-snapshot.js';
import { columns, exportResultColumn, executionPurposeColumn, Failure } from './sql.js';
import type { Row } from './sql.js';

/** Bounded debt backfill, with no invented native custody or closure authority. */
export function migration014(db: DatabaseSync): void {
  const retained = db.prepare(`SELECT attempt_id FROM accepted_attempts ORDER BY id LIMIT ${DISK_HOLD_LIMIT + 1}`).all();
  if (retained.length > DISK_HOLD_LIMIT) throw new Failure('unavailable');
  db.exec(absenceTables);
  const original = db.prepare(`SELECT ${columns.replace(exportResultColumn,'NULL AS export_result_json').replace(executionPurposeColumn,"'performance' AS execution_purpose")} FROM accepted_attempts WHERE attempt_id=?`);
  // Keep only bounded keys, then validate one bounded original at a time. Retained
  // result projections must never be materialized together during an upgrade.
  for (const key of retained) {
    if (typeof key.attempt_id !== 'string') throw new Failure('unavailable');
    const row = original.get(key.attempt_id) as unknown as Row | undefined;
    if (!row) throw new Failure('unavailable');
    admissionSnapshot(db, row);
  }
  db.exec(absenceFacts);
  db.exec(`UPDATE accepted_attempts SET absence_pending=${absencePending('accepted_attempts')}`);
  db.exec(absenceParentGuards); db.exec(absenceGuards); db.exec(absenceFences); db.exec(absenceDebt);
  db.exec('PRAGMA user_version=14');
}
