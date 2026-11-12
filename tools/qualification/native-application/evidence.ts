import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SQLOutputValue } from 'node:sqlite';
import { encodeCanonicalJson, validate, validatePrimitive } from '@beetle/contracts';
import { verifySourceEnvelope } from '@beetle/contracts/output-source';
import type { Run, RunResultSnapshot } from '@beetle/contracts/api';
import { digest } from '../../../agent/test/container/fixture.js';
import type { Fixture } from '../../../agent/test/container/fixture.js';
import { EVENT_ROW_ALLOWANCE } from '../../../app/src/ports/events.js';

type Row = Record<string, SQLOutputValue>;
function row(db: DatabaseSync, table: 'execution_output_sources' | 'execution_output_payloads' | 'execution_output_finalizations' |
  'execution_records' | 'event_cursors' | 'attempt_output_allocations', attemptId: string): Row {
  // Table names are hard-coded callers; all reads run after the owning worker closes.
  const rows = db.prepare(`SELECT * FROM ${table} WHERE attempt_id=? LIMIT 2`).all(attemptId);
  assert.equal(rows.length, 1, `Expected one ${table} row`); return rows[0]!;
}
function json(text: SQLOutputValue | undefined, maximum: number): unknown {
  assert(typeof text === 'string' && Buffer.byteLength(text) <= maximum); return JSON.parse(text) as unknown;
}
export function retainedCharge(eventBytes: number, manifestBytes: number, artifactBytes: number, maximum: number) {
  for (const amount of [eventBytes, manifestBytes, artifactBytes, maximum]) assert(Number.isSafeInteger(amount) && amount >= 0);
  const retained = eventBytes + manifestBytes + artifactBytes;
  assert(Number.isSafeInteger(retained) && retained <= maximum && Number.isSafeInteger(retained + 65536));
  return { retained, refunded: maximum - retained, charged: retained + 65536 };
}
async function publishedBytes(path: string, expected: number): Promise<Buffer> {
  assert(expected >= 0 && expected <= 1_048_576);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    assert(info.isFile() && info.nlink === 1 && info.uid === process.getuid?.() && (info.mode & 0o777) === 0o600);
    assert.equal(info.size, expected);
    const buffer = Buffer.alloc(expected + 1); let size = 0;
    for (let calls = 0; calls < 64; calls++) {
      const next = await handle.read(buffer, size, buffer.length - size, size); size += next.bytesRead;
      assert(size <= expected);
      if (next.bytesRead === 0) { assert.equal(size, expected); return buffer.subarray(0, size); }
    }
    throw new Error('Published artifact read calls exceeded');
  } finally { await handle.close(); }
}
/** Independent, bounded, read-only inspection after application close. */
export async function inspectClosed(f: Fixture, run: Run, result: RunResultSnapshot) {
  const db = new DatabaseSync(join(f.root, 'backend/metadata.sqlite'), { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000;');
    assert.equal(db.prepare('SELECT id FROM attempts LIMIT 2').all().length, 1);
    const original = db.prepare('SELECT offer_json FROM attempts WHERE id=? LIMIT 1').get(run.activeAttemptId);
    const offer = validate('Offer', json(original?.offer_json, 2_097_152)); assert(offer.ok);
    assert.equal(offer.value.attemptId, run.activeAttemptId); assert.equal(offer.value.organizationId, run.scope.organizationId);
    assert.equal(offer.value.workspaceId, run.scope.workspaceId); assert.deepEqual(offer.value.installedIdentity, f.offer.installedIdentity);
    assert.deepEqual(offer.value.config, f.offer.config); assert.deepEqual(offer.value.budget, f.budget);
    const source = row(db, 'execution_output_sources', run.activeAttemptId);
    const payload = row(db, 'execution_output_payloads', run.activeAttemptId); assert.equal(payload.kind, 'manifest');
    const envelope = verifySourceEnvelope({ version: 1, manifest: json(payload.canonical_json, 73728),
      closure: json(source.closure_json, 4096), sourceDigest: source.source_digest }, digest);
    assert.equal(envelope.manifest.binding.attemptId, offer.value.attemptId);
    assert.equal(envelope.manifest.binding.organizationId, offer.value.organizationId);
    assert.equal(envelope.manifest.binding.workspaceId, offer.value.workspaceId);
    assert.equal(envelope.manifest.binding.intentDigest, offer.value.intentDigest);
    assert.deepEqual(envelope.manifest.binding.engine, offer.value.engine);
    assert.deepEqual(envelope.manifest.binding.installedIdentity, offer.value.installedIdentity);
    assert.deepEqual(envelope.manifest.result, result.result);
    const receipt = row(db, 'execution_output_finalizations', run.activeAttemptId);
    const allocation = row(db, 'attempt_output_allocations', run.activeAttemptId);
    assert.equal(allocation.maximum_payload_bytes, f.budget.outputBytes); assert.equal(allocation.metadata_bytes, 65536);
    assert.equal(allocation.charged_bytes, f.budget.outputBytes + 65536);
    const execution = row(db, 'execution_records', run.activeAttemptId);
    const header = json(execution.snapshot_json, 2048) as { admission: { state: string; disposition: string }; lastSeq: number;
      exitEvidence: { exitCode: number; oomKilled: boolean } };
    assert.deepEqual(header.admission, { state: 'released', disposition: 'settled' });
    assert.equal(header.exitEvidence.exitCode, 0); assert.equal(header.exitEvidence.oomKilled, false);
    assert(typeof source.final_agent_seq === 'number' && header.lastSeq <= source.final_agent_seq);
    const cursor = row(db, 'event_cursors', run.activeAttemptId);
    assert.equal(execution.execution_charged, 0); assert.equal(execution.event_pending, 0);
    assert.equal(cursor.blocked_reason, null); assert.equal(cursor.coverage, 'contiguous');
    for (const field of ['durable_through', 'ack_confirmed_through', 'event_count']) assert.equal(cursor[field], source.final_agent_seq);
    const artifacts = await inspectArtifacts(db, f, run, envelope.manifest.result.artifacts);
    const events = db.prepare('SELECT canonical_json FROM run_events WHERE attempt_id=? ORDER BY seq LIMIT 129').all(run.activeAttemptId);
    assert(events.length > 0 && events.length <= 128); assert.equal(events.length, source.final_agent_seq);
    const eventBytes = events.reduce((sum, event, index) => {
      const checked = validate('AgentEvent', json(event.canonical_json, 4096)); assert(checked.ok);
      assert.equal(checked.value.seq, index + 1);
      return sum + Buffer.byteLength(encodeCanonicalJson(checked.value, 4096)) + EVENT_ROW_ALLOWANCE;
    }, 0);
    const charge = retainedCharge(eventBytes, Buffer.byteLength(payload.canonical_json as string), artifacts.bytes, f.budget.outputBytes);
    assert.equal(receipt.retained_payload_bytes, charge.retained); assert.equal(receipt.refunded_bytes, charge.refunded);
    assert.equal(receipt.run_version, run.version); assert.equal(receipt.state, run.state); assert.equal(receipt.outcome, run.outcome);
    assert.equal(receipt.source_digest, source.source_digest); assert.equal(receipt.manifest_digest, envelope.manifest.manifestDigest);
    assert.equal(receipt.final_agent_seq, source.final_agent_seq);
    assert.equal(receipt.attempt_id, run.activeAttemptId); assert.equal(receipt.run_id, run.id);
    assert.equal(receipt.journal_authority, execution.journal_authority);
    assert.equal(receipt.journal_authority, envelope.manifest.binding.journalAuthority);
    assert.equal(db.prepare('SELECT charged_bytes FROM installation_storage_usage WHERE id=1').get()!.charged_bytes, charge.charged);
    return { offer: offer.value, receipt, charge, artifacts: artifacts.entries, eventCount: events.length };
  } finally { db.close(); }
}
async function inspectArtifacts(db: DatabaseSync, f: Fixture, run: Run, artifacts: NonNullable<RunResultSnapshot['result']>['artifacts']) {
  // The sealed contract permits up to128 artifacts, including retained metric history.
  assert(artifacts.length <= 128);
  const slots = db.prepare('SELECT ordinal,slot_json FROM execution_output_slots WHERE attempt_id=? ORDER BY ordinal LIMIT 129').all(run.activeAttemptId);
  assert.equal(slots.length, artifacts.length);
  const entries = []; let bytes = 0;
  for (const [index, slot] of slots.entries()) {
    assert.equal(slot.ordinal, index);
    const state = json(slot.slot_json, 1024) as { p: string; w: unknown; t: string; o: number };
    assert.equal(state.p, 'published'); assert.equal(state.w, null); assert(validatePrimitive('uuid', state.t).ok);
    const expected = artifacts[index]!; assert.equal(state.o, expected.bytes);
    const actual = await publishedBytes(join(f.root, 'backend/outputs/published', run.scope.organizationId,
      run.scope.workspaceId, run.id, run.activeAttemptId, state.t), expected.bytes);
    assert.equal(digest(actual), expected.sha256); bytes += actual.length;
    entries.push({ relativePath: expected.relativePath, bytes: actual.length, sha256: digest(actual) });
  }
  return { entries, bytes };
}
