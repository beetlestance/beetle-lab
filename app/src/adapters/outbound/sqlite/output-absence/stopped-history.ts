import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { LIVE_HISTORY_BYTES } from '@beetle/contracts/api';
import { captureStoredStoppedObservation } from '@beetle/contracts/output-source';
import type { StoppedObservation } from '@beetle/contracts/output-source';
import type { OutputAbsenceState } from '../../../../ports/output-absence.js';
import { sha256 } from '../input-values.js';
import { StorageError } from '../protocol.js';

type Permit = StoppedObservation & { attempt: string; proofDigest: string };
const originals = new WeakMap<DatabaseSync, Permit>();

export function registerStoppedHistory(db: DatabaseSync): void {
  db.function('backend_stopped_history_insert', (attempt, proof, json, digest, bytes) => {
    const permit = originals.get(db);
    return permit &&
      permit.attempt === attempt &&
      permit.proofDigest === proof &&
      permit.json === json &&
      permit.digest === digest &&
      permit.bytes === bytes
      ? 1
      : 0;
  });
}
type Row = Record<string, SQLOutputValue>;
export function eligibleStoppedHistory(proof: OutputAbsenceState, row: Row): boolean {
  return (
    proof.closure.admission.state === 'released' &&
    proof.closure.admission.disposition === 'settled' &&
    proof.closure.finalAgentSeq > 0 &&
    row.history_ready === 1
  );
}

export function retainStoppedHistory(
  db: DatabaseSync,
  proof: OutputAbsenceState,
  row: Row,
  observation: StoppedObservation,
): number {
  if (!eligibleStoppedHistory(proof, row)) return 0;
  if (typeof row.retained_payload_bytes !== 'number' || typeof row.maximum_payload_bytes !== 'number')
    throw new StorageError('unavailable');
  if (observation.bytes > row.maximum_payload_bytes - row.retained_payload_bytes) return 0;
  if (!db.isTransaction || originals.has(db)) throw new StorageError('unavailable');
  const attempt = proof.binding.key.attempt.attemptId;
  originals.set(db, { ...observation, attempt, proofDigest: proof.proofDigest });
  try {
    db.prepare(
      'INSERT INTO execution_stopped_history(attempt_id,proof_digest,canonical_json,digest,bytes) VALUES(?,?,?,?,?)',
    ).run(attempt, proof.proofDigest, observation.json, observation.digest, observation.bytes);
    return observation.bytes;
  } finally {
    originals.delete(db);
  }
}

/** Callers already own the scoped, validated absence proof in the same read. */
export function readRetainedStoppedHistory(db: DatabaseSync, proof: OutputAbsenceState): StoppedObservation | null {
  const a = proof.binding.key.attempt;
  const row = db
    .prepare(
      `SELECT proof_digest,digest,bytes,
      CASE WHEN length(CAST(canonical_json AS BLOB))<=? THEN canonical_json END json
      FROM execution_stopped_history WHERE attempt_id=?`,
    )
    .get(LIVE_HISTORY_BYTES, a.attemptId);
  if (!row) return null;
  if (row.proof_digest !== proof.proofDigest) throw new StorageError('unavailable');
  try {
    return captureStoredStoppedObservation(
      { json: row.json, digest: row.digest, bytes: row.bytes },
      { ...a, journalAuthority: proof.binding.journalAuthority },
      sha256,
    );
  } catch {
    throw new StorageError('unavailable');
  }
}

export function requireAbsenceCharge(
  db: DatabaseSync,
  proof: OutputAbsenceState,
  receiptBytes: unknown,
  verifyHistory: boolean,
): void {
  const attempt = proof.binding.key.attempt.attemptId;
  // Retention can admit a page in one transaction. Full payload decode belongs to the single-run settlement.
  const h = verifyHistory ? (readRetainedStoppedHistory(db, proof)?.bytes ?? 0) : stoppedHistoryCharge(db, proof);
  const row = db
    .prepare(
      `SELECT coalesce((SELECT retained_bytes FROM event_cursors WHERE attempt_id=?),0)
      +coalesce((SELECT length(CAST(canonical_json AS BLOB)) FROM execution_output_payloads WHERE attempt_id=? AND kind='result'),0) AS retained`,
    )
    .get(attempt, attempt);
  if (typeof row?.retained !== 'number' || receiptBytes !== row.retained + h) throw new StorageError('unavailable');
}

function stoppedHistoryCharge(db: DatabaseSync, proof: OutputAbsenceState): number {
  const row = db
    .prepare(
      'SELECT proof_digest,bytes,length(CAST(canonical_json AS BLOB)) actual FROM execution_stopped_history WHERE attempt_id=?',
    )
    .get(proof.binding.key.attempt.attemptId);
  if (!row) return 0;
  if (
    row.proof_digest !== proof.proofDigest ||
    typeof row.bytes !== 'number' ||
    row.bytes < 1 ||
    row.bytes > LIVE_HISTORY_BYTES ||
    row.bytes !== row.actual
  )
    throw new StorageError('unavailable');
  return row.bytes;
}
