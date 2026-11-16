import type { DatabaseSync } from 'node:sqlite';
import { captureOutputAbsence, OUTPUT_ABSENCE_BYTES, OUTPUT_REJECTION_REASONS } from '@beetle/contracts/output-source';
import type { OutputAbsence, Owned } from '@beetle/contracts/output-source';
import type { AttemptAdmission } from '@beetle/contracts';
import type { Scope } from '../admission/index.js';
import { admissionSnapshot } from './admission-snapshot.js';
import { readJournalAuthority } from './authority.js';
import { readSourceState } from './output-source-context.js';
import { sourceJson, sourceScope, sameSource } from './output-source-input.js';
import { OUTPUT_ABSENCE_ROW_ALLOWANCE } from './output-absence-protocol.js';
import type { OutputAbsenceOperation } from './output-absence-protocol.js';
import { Failure, owner, quotaUsed, transaction } from './sql.js';
import type { Row } from './sql.js';

export function outputAbsenceOperation(input: { kind: string }): input is OutputAbsenceOperation {
  return input.kind === 'outputAbsenceClose' || input.kind === 'outputAbsenceRead';
}
function requireFact(value: unknown): asserts value { if (!value) throw new Failure('unavailable'); }
function diagnostic(db: DatabaseSync, row: Row, fallback: OutputAbsence['reason']): OutputAbsence['reason'] {
  const record = db.prepare(`SELECT cancel_reason FROM supervision_clock WHERE attempt_id=?`).get(row.attempt_id);
  const exit = JSON.parse(row.exit_facts_json ?? row.exit_json ?? '{}') as { reason?: unknown };
  const reason = record?.cancel_reason ?? exit.reason;
  return ['cancelled', 'timeout', 'output_limit', 'artifact_incomplete', 'clock_integrity', 'setup_failed',
    'unsupported_capability', 'budget_unavailable'].includes(String(reason)) ? reason as OutputAbsence['reason'] : fallback;
}
function identity(db: DatabaseSync, row: Row) {
  requireFact(row.generation === 1);
  return { attemptId: row.attempt_id, organizationId: row.organization_id, workspaceId: row.workspace_id,
    generation: 1 as const, intentDigest: row.intent_digest, journalAuthority: readJournalAuthority(db) };
}
function stored(db: DatabaseSync, row: Row): Owned<OutputAbsence> | null {
  const record = db.prepare(`SELECT charged_bytes, CASE WHEN typeof(proof_json)='text'
    AND length(CAST(proof_json AS BLOB))<=${OUTPUT_ABSENCE_BYTES} THEN proof_json END AS json
    FROM output_absence_closures WHERE attempt_id=?`).get(row.attempt_id);
  if (!record) { requireFact(row.absence_bytes === 0); return null; }
  try {
    requireFact(typeof record.json === 'string');
    const proof = captureOutputAbsence(JSON.parse(record.json) as unknown, identity(db, row));
    requireFact(sourceJson(proof, OUTPUT_ABSENCE_BYTES) === record.json);
    requireFact(record.charged_bytes === Buffer.byteLength(record.json) + OUTPUT_ABSENCE_ROW_ALLOWANCE
      && row.absence_bytes === record.charged_bytes && row.absence_pending === 0);
    requireFact(quotaUsed(row) <= row.quota_bytes && proof.finalAgentSeq === row.last_seq);
    requireFact(sameSource(admissionSnapshot(db, row), proof.admission));
    requireFact(!db.prepare(`SELECT 1 FROM output_sources WHERE attempt_id=? UNION ALL
      SELECT 1 FROM output_delivery_closures WHERE attempt_id=? LIMIT 1`).get(row.attempt_id, row.attempt_id));
    return proof;
  } catch { throw new Failure('unavailable'); }
}
function definitive(admission: AttemptAdmission | undefined): admission is OutputAbsence['admission'] {
  return admission?.state === 'rejected' || admission?.state === 'released';
}
function closureReason(db: DatabaseSync, row: Row, admission: OutputAbsence['admission']): OutputAbsence['reason'] {
  if (admission.state === 'rejected') return OUTPUT_REJECTION_REASONS[admission.reason];
  if (admission.disposition === 'settled') {
    requireFact(db.prepare(`SELECT json_extract(reservation_json,'$.releaseEvidence.collection.state') AS state
      FROM reservations WHERE attempt_id=?`).get(row.attempt_id)?.state === 'failed');
  }
  return diagnostic(db, row, admission.disposition === 'never_started' ? 'setup_failed' : 'artifact_incomplete');
}
function closeAbsence(db: DatabaseSync, key: Scope): Owned<OutputAbsence> | null {
  const row = owner(db, key); const prior = stored(db, row); if (prior) return prior;
  const admission = admissionSnapshot(db, row);
  if (!definitive(admission)) return null;
  // Source-context validation reuses collection/release binding checks. In particular,
  // a recovered pending intent remains owned and cannot become a failed collection.
  const state = readSourceState(db, key);
  if (state.source || state.intent?.phase === 'pending' || row.delivery_bytes !== 0) return null;
  const reason = closureReason(db, row, admission);
  const proof = captureOutputAbsence({ version: 1, ...identity(db, row), finalAgentSeq: row.last_seq, admission, reason });
  const json = sourceJson(proof, OUTPUT_ABSENCE_BYTES); const charge = Buffer.byteLength(json) + OUTPUT_ABSENCE_ROW_ALLOWANCE;
  if (quotaUsed(row, { absence_bytes: charge }) > row.quota_bytes) throw new Failure('quota_exceeded');
  db.prepare('INSERT INTO output_absence_closures(attempt_id,proof_json,charged_bytes) VALUES(?,?,?)').run(key.attemptId, json, charge);
  return proof;
}
/** Caller owns the transaction; no closure or native fact is created. */
export function readOutputAbsenceAtomic(db: DatabaseSync, key: Scope): Owned<OutputAbsence> | null {
  return stored(db, owner(db, key));
}
/** Trusted storage only: native retirement is established by the calling owner. */
export function executeOutputAbsence(db: DatabaseSync, input: OutputAbsenceOperation): Owned<OutputAbsence> | null {
  let key: Scope;
  try { key = sourceScope(input.key); } catch { throw new Failure('invalid_input'); }
  return transaction(db, () => input.kind === 'outputAbsenceClose' ? closeAbsence(db, key) : readOutputAbsenceAtomic(db, key));
}
