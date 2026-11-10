import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SQLOutputValue } from 'node:sqlite';
import { encodeCanonicalJson, validate } from '@beetle/contracts';
import { captureOutputAbsence } from '@beetle/contracts/output-source';
import type { OutputAbsence } from '@beetle/contracts/output-source';
import type { Run } from '@beetle/contracts/api';
import { digest } from '../../../agent/test/container/fixture.js';
import type { Fixture } from '../../../agent/test/container/fixture.js';
import { EVENT_ROW_ALLOWANCE } from '../../../app/src/ports/events.js';
import { loadAgentConfiguration } from '../../../agent/src/bootstrap/index.js';
import { initializationWorkerUrl } from './initialize.js';
import { absenceCharge } from './absence-values.js';

type Row = Record<string, SQLOutputValue>;
const bounded = (name: string, maximum: number) =>
  `CASE WHEN length(CAST(${name} AS BLOB))<=${maximum} THEN ${name} END AS ${name}`;
function one(db: DatabaseSync, sql: string, key?: string): Row {
  const rows = key === undefined ? db.prepare(`${sql} LIMIT 2`).all() : db.prepare(`${sql} LIMIT 2`).all(key);
  assert.equal(rows.length, 1, 'Expected exactly one persisted row'); return rows[0]!;
}
function json(value: SQLOutputValue | undefined, maximum: number): unknown {
  assert(typeof value === 'string' && Buffer.byteLength(value) <= maximum); return JSON.parse(value) as unknown;
}
function empty(db: DatabaseSync, tables: readonly string[], attempt: string) {
  // Table names are fixed harness constants; only existence is materialized.
  for (const table of tables) assert.equal(db.prepare(`SELECT 1 FROM ${table} WHERE attempt_id=? LIMIT 1`).get(attempt), undefined, table);
}
function binding(row: Row, proof: OutputAbsence, run: Run) {
  for (const [column, expected] of Object.entries({ attempt_id: proof.attemptId, run_id: run.id,
    organization_id: proof.organizationId, workspace_id: proof.workspaceId, intent_digest: proof.intentDigest,
    journal_authority: proof.journalAuthority, generation: proof.generation })) assert.equal(row[column], expected, column);
}
function eventCharge(db: DatabaseSync, proof: OutputAbsence, cursor: Row): number {
  const events = db.prepare(`SELECT seq,generation,charged_bytes,cumulative_bytes,${bounded('canonical_json', 65536)}
    FROM run_events WHERE attempt_id=? ORDER BY seq LIMIT 129`).all(proof.attemptId);
  assert(events.length <= 128); assert.equal(events.length, proof.finalAgentSeq);
  let bytes = 0;
  for (const [index, event] of events.entries()) {
    const checked = validate('AgentEvent', json(event.canonical_json, 65536)); assert(checked.ok);
    assert.equal(event.seq, index + 1); assert.equal(checked.value.seq, index + 1); assert.equal(event.generation, 1);
    assert.equal(checked.value.attemptId, proof.attemptId);
    const encoded = encodeCanonicalJson(checked.value, 65536); assert.equal(event.canonical_json, encoded);
    const charge = Buffer.byteLength(encoded) + EVENT_ROW_ALLOWANCE;
    assert.equal(event.charged_bytes, charge); bytes += charge; assert.equal(event.cumulative_bytes, bytes);
  }
  assert.equal(cursor.retained_bytes, bytes); return bytes;
}
function metadataFacts(db: DatabaseSync, f: Fixture, run: Run) {
  assert.equal(db.prepare('SELECT id FROM attempts LIMIT 2').all().length, 1);
  const original = one(db, `SELECT ${bounded('offer_json', 1048576)} FROM attempts WHERE id=?`, run.activeAttemptId);
  const offer = validate('Offer', json(original.offer_json, 1048576)); assert(offer.ok);
  assert.equal(offer.value.attemptId, run.activeAttemptId); assert.equal(offer.value.organizationId, run.scope.organizationId);
  assert.equal(offer.value.workspaceId, run.scope.workspaceId); assert.deepEqual(offer.value.installedIdentity, f.offer.installedIdentity);
  assert.deepEqual(offer.value.config, f.offer.config); assert.deepEqual(offer.value.engine, f.offer.engine);
  assert.deepEqual(offer.value.budget, f.budget); assert(offer.value.budget.cpuMillis < f.manifest.minimumBudget.cpuMillis);
  const absence = one(db, `SELECT attempt_id,run_id,organization_id,workspace_id,intent_digest,journal_authority,
    generation,final_agent_seq,proof_digest,${bounded('proof_json', 2048)} FROM execution_output_absences WHERE attempt_id=?`, run.activeAttemptId);
  assert(typeof absence.journal_authority === 'string');
  const proof = captureOutputAbsence(json(absence.proof_json, 2048), { attemptId: offer.value.attemptId,
    organizationId: offer.value.organizationId, workspaceId: offer.value.workspaceId, generation: 1,
    intentDigest: offer.value.intentDigest, journalAuthority: absence.journal_authority });
  assert.equal(absence.proof_json, encodeCanonicalJson(proof, 2048));
  assert.equal(absence.proof_digest, digest(absence.proof_json as string)); binding(absence, proof, run);
  assert.equal(proof.intentDigest, offer.value.intentDigest);
  assert.deepEqual(proof.admission, { state: 'rejected', reason: 'below_manifest_minimum' });
  assert.equal(proof.reason, 'budget_unavailable'); assert.equal(absence.final_agent_seq, proof.finalAgentSeq);
  empty(db, ['execution_output_sources', 'execution_output_payloads', 'execution_output_slots', 'execution_output_finalizations'], run.activeAttemptId);
  return { offer: offer.value, proof, proofDigest: absence.proof_digest };
}
function settlement(db: DatabaseSync, f: Fixture, run: Run, proof: OutputAbsence, proofDigest: SQLOutputValue) {
  const receipt = one(db, 'SELECT * FROM execution_output_absence_finalizations WHERE attempt_id=?', run.activeAttemptId);
  binding(receipt, proof, run); assert.equal(receipt.proof_digest, proofDigest);
  assert.equal(receipt.final_agent_seq, proof.finalAgentSeq); assert.equal(receipt.run_version, run.version);
  for (const [column, expected] of Object.entries({ state: run.state, outcome: run.outcome,
    validation_status: run.validationStatus, reason: run.reason })) assert.equal(receipt[column], expected);
  const execution = one(db, `SELECT execution_charged,event_pending,output_pending,journal_authority,
    ${bounded('snapshot_json', 2048)} FROM execution_records WHERE attempt_id=?`, run.activeAttemptId);
  const checked = validate('AttemptSnapshot', json(execution.snapshot_json, 2048)); assert(checked.ok);
  assert.deepEqual(checked.value.admission, proof.admission); assert.equal(checked.value.result, undefined);
  assert.equal(checked.value.lastSeq, proof.finalAgentSeq);
  for (const key of ['organizationId', 'workspaceId', 'attemptId', 'generation', 'intentDigest'] as const) {
    assert.equal(checked.value[key], proof[key]);
  }
  for (const field of ['execution_charged', 'event_pending']) assert.equal(execution[field], 0);
  assert.equal(execution.output_pending, 1); // Immutable original output obligation; receipt closes discovery.
  assert.equal(execution.journal_authority, proof.journalAuthority);
  const cursor = one(db, 'SELECT * FROM event_cursors WHERE attempt_id=?', run.activeAttemptId);
  binding(cursor, proof, run); assert.equal(cursor.coverage, 'contiguous'); assert.equal(cursor.blocked_reason, null);
  for (const field of ['durable_through', 'ack_confirmed_through', 'event_count']) assert.equal(cursor[field], proof.finalAgentSeq);
  const charge = absenceCharge(eventCharge(db, proof, cursor), 0, f.budget.outputBytes);
  assert.equal(receipt.retained_payload_bytes, charge.retained); assert.equal(receipt.refunded_bytes, charge.refunded);
  const allocation = one(db, 'SELECT * FROM attempt_output_allocations WHERE attempt_id=?', run.activeAttemptId);
  assert.equal(allocation.maximum_payload_bytes, f.budget.outputBytes); assert.equal(allocation.metadata_bytes, 65536);
  assert.equal(allocation.charged_bytes, f.budget.outputBytes + 65536);
  assert.equal(one(db, 'SELECT charged_bytes FROM installation_storage_usage WHERE id=1').charged_bytes, charge.charged);
  return { receipt, charge, snapshot: checked.value };
}
/** No production finalizer, receipt math or SQL views participate in this oracle. */
export function inspectAbsence(f: Fixture, run: Run) {
  const db = new DatabaseSync(join(f.root, 'backend/metadata.sqlite'), { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000; PRAGMA cache_size=-2048;');
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 12);
    const facts = metadataFacts(db, f, run);
    return { ...facts, ...settlement(db, f, run, facts.proof, facts.proofDigest) };
  } finally { db.close(); }
}
/** Agent has stopped; use the real loader's journal path, then release loader custody. */
export async function inspectJournal(f: Fixture, expected: ReturnType<typeof inspectAbsence>) {
  const loaded = await loadAgentConfiguration({ BEETLE_AGENT_CONFIG_FILE: f.configPath }, initializationWorkerUrl());
  const path = loaded.runtime.journal.path;
  await loaded.close();
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000; PRAGMA cache_size=-2048;');
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 14);
    assert.equal(one(db, 'SELECT authority FROM journal_authority WHERE id=1').authority, expected.proof.journalAuthority);
    assert.equal(db.prepare('SELECT attempt_id FROM accepted_attempts LIMIT 2').all().length, 1);
    const attempt = one(db, `SELECT last_seq,acknowledged_seq,absence_bytes,absence_pending,result_json IS NULL result_absent,
      ${bounded('offer_json', 1048576)} FROM accepted_attempts WHERE attempt_id=?`, expected.proof.attemptId);
    assert.deepEqual(json(attempt.offer_json, 1048576), expected.offer);
    assert.equal(attempt.last_seq, expected.proof.finalAgentSeq); assert.equal(attempt.acknowledged_seq, expected.proof.finalAgentSeq);
    assert.equal(attempt.absence_pending, 0); assert.equal(attempt.result_absent, 1);
    const closure = one(db, `SELECT charged_bytes,${bounded('proof_json', 2048)} FROM output_absence_closures WHERE attempt_id=?`, expected.proof.attemptId);
    assert.deepEqual(captureOutputAbsence(json(closure.proof_json, 2048)), expected.proof);
    assert.equal(digest(closure.proof_json as string), expected.proofDigest);
    assert.equal(closure.charged_bytes, Buffer.byteLength(closure.proof_json as string) + 256);
    assert.equal(attempt.absence_bytes, closure.charged_bytes);
    const queue = one(db, `SELECT pending,${bounded('decision_json', 512)} FROM admission_queue WHERE attempt_id=?`, expected.proof.attemptId);
    assert.equal(queue.pending, 0); assert.deepEqual(json(queue.decision_json, 512), { kind: 'reject', reason: 'below_manifest_minimum' });
    empty(db, ['reservations', 'output_sources', 'output_delivery_closures', 'output_collection_intents', 'disk_holds'], expected.proof.attemptId);
    return { path, authority: expected.proof.journalAuthority, closureBytes: closure.charged_bytes,
      finalAgentSeq: attempt.last_seq, acknowledgedSeq: attempt.acknowledged_seq, reservations: 0 };
  } finally { db.close(); }
}
