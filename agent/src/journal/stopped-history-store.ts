import type { DatabaseSync } from 'node:sqlite';
import { LIVE_HISTORY_BYTES } from '@beetle/contracts/api';
import type { OutputAbsence } from '@beetle/contracts/output-source';
import type { Scope } from '../admission/index.js';
import { Failure, owner, quotaUsed } from './sql.js';
import type { Row } from './sql.js';
import type { StoppedObservation } from './stopped-history-value.js';
import { captureStoppedObservation, STOPPED_HISTORY_ROW_ALLOWANCE } from './stopped-history-value.js';

type Permit = StoppedObservation & { attemptId: string; charge: number };
const permits = new WeakMap<DatabaseSync, Permit>();
export function registerStoppedHistory(db: DatabaseSync): void {
  db.function('agent_stopped_history_insert_allowed', (attemptId, json, digest, charge) => {
    const permit = permits.get(db);
    return permit &&
      permit.attemptId === attemptId &&
      permit.json === json &&
      permit.digest === digest &&
      permit.charge === charge
      ? 1
      : 0;
  });
}

/** The caller already inserted the immutable absence in this transaction. */
export function storeStoppedObservation(
  db: DatabaseSync,
  key: Scope,
  absence: { row: Row; charge: number; admission: OutputAbsence['admission'] },
  json: unknown,
): void {
  const { row, admission } = absence;
  if (admission.state !== 'released' || admission.disposition !== 'settled') return;
  if (row.execution_purpose !== 'performance' || row.state !== 'exited' || row.exit_facts_json === null) return;
  const value = optionalObservation(key, json);
  if (!value) return;
  const charge = value.bytes + STOPPED_HISTORY_ROW_ALLOWANCE;
  if (charge > row.quota_bytes - quotaUsed(row, { absence_bytes: absence.charge })) return;
  if (!fundedLaunch(db, key, charge)) return;
  insertObservation(db, key, value, charge);
}

function insertObservation(db: DatabaseSync, key: Scope, value: StoppedObservation, charge: number): void {
  if (!db.isTransaction || permits.has(db)) throw new Failure('unavailable');
  permits.set(db, { ...value, attemptId: key.attemptId, charge });
  try {
    db.prepare(
      'INSERT INTO stopped_history_observations(attempt_id,history_json,history_digest,charged_bytes) VALUES(?,?,?,?)',
    ).run(key.attemptId, value.json, value.digest, charge);
  } finally {
    permits.delete(db);
  }
}

function optionalObservation(key: Scope, json: unknown): StoppedObservation | undefined {
  try {
    return captureStoppedObservation(key, json);
  } catch {
    return undefined;
  }
}

function fundedLaunch(db: DatabaseSync, key: Scope, charge: number): boolean {
  const launch = db
    .prepare(
      `SELECT json_extract(reservation_json,'$.budget.outputBytes') maximum,
      json_extract(reservation_json,'$.releaseEvidence.launch.epoch') epoch,
      json_extract(reservation_json,'$.releaseEvidence.runtime.state') runtime
      FROM reservations WHERE attempt_id=?`,
    )
    .get(key.attemptId);
  return (
    typeof launch?.maximum === 'number' &&
    charge <= launch.maximum &&
    launch.epoch === 1 &&
    launch.runtime === 'stopped'
  );
}

export function readStoppedObservation(db: DatabaseSync, key: Scope) {
  const row = owner(db, key);
  const record = db
    .prepare(
      `SELECT CASE WHEN length(CAST(history_json AS BLOB))<=? THEN history_json END json,
     history_digest, charged_bytes FROM stopped_history_observations WHERE attempt_id=?`,
    )
    .get(LIVE_HISTORY_BYTES, key.attemptId);
  if (!record) return null;
  try {
    const observation = captureStoppedObservation(key, record.json);
    if (
      record.history_digest !== observation.digest ||
      record.charged_bytes !== observation.bytes + STOPPED_HISTORY_ROW_ALLOWANCE ||
      record.charged_bytes > row.quota_bytes - quotaUsed(row)
    )
      throw new Error();
    return observation;
  } catch {
    throw new Failure('unavailable');
  }
}
