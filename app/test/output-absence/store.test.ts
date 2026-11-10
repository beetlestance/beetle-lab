import { expect, it } from 'vitest';
import { encodeCanonicalJson } from '@beetle/contracts';
import { absenceFixture } from './fixture.js';
import { uuid, scope, requestId, digest } from '../storage/fixture.js';
import { prepareCancelRunCommand } from '../../src/application/runs/index.js';
import { captureAbsenceOperation, captureAbsenceReply } from '../../src/adapters/outbound/sqlite/output-absence/index.js';
import { finalizationFixture } from '../output-finalization/fixture.js';

it('retains actual provisional result C+R, credits once and keeps original allocations plus metadata charge', () => {
  const f = absenceFixture(); f.adopt(); f.release({ result: f.value }); f.ingest(); f.confirm();
  const bytes = Buffer.byteLength(encodeCanonicalJson(f.value, 65536)) + Number(f.cursor().retained_bytes);
  const before = f.usage(); const allocation = f.db.prepare('SELECT * FROM attempt_output_allocations').get();
  const command = f.command(); const reply = f.finalize();
  expect(reply).toMatchObject({ kind: 'finalized', receipt: { retainedPayloadBytes: bytes, refundedBytes: 10000 - bytes,
    state: 'errored', outcome: 'inconclusive', validationStatus: 'pending', reason: 'artifact_incomplete' } });
  expect(f.usage()).toBe(65536 + bytes); expect(f.usage()).toBe(before - (10000 - bytes));
  expect(f.db.prepare('SELECT * FROM attempt_output_allocations').get()).toEqual(allocation);
  expect(f.db.prepare('SELECT canonical_json FROM execution_output_payloads').get()?.canonical_json).toBe(encodeCanonicalJson(f.value, 65536));
  expect(f.absences.execute({ kind: 'absenceFinalize', request: { ...command, expectedRunVersion: 1 } })).toEqual(reply);
  expect(f.adopt()).toMatchObject({ closure: f.proof });
  expect(f.db.prepare('SELECT count(*) n FROM execution_output_finalizations').get()?.n).toBe(0);
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

it.each([{ state: 'rejected', reason: 'per_run_ceiling' }, { state: 'released', disposition: 'never_started' },
  { state: 'released', disposition: 'settled' }] as const)('settles definitive admission %j without a successful outcome', admission => {
  const reason = admission.state === 'rejected' ? 'budget_unavailable' : admission.disposition === 'never_started' ? 'setup_failed' : 'artifact_incomplete';
  const f = absenceFixture({ admission, reason }); f.ready();
  expect(f.finalize()).toMatchObject({ kind: 'finalized', receipt: { state: 'errored', outcome: 'inconclusive', validationStatus: 'pending', reason } });
});

it('keeps unknown charged execution, older header and ACK debt pending; beyond-end fails', () => {
  const f = absenceFixture(); expect(f.finalize()).toEqual({ kind: 'pending', reason: 'proof' });
  f.adopt(); expect(f.finalize()).toEqual({ kind: 'pending', reason: 'execution' });
  const older = absenceFixture({ end: 3 }); older.adopt(); older.release({ lastSeq: 2 }); older.ingest(); older.confirm();
  expect(older.finalize()).toEqual({ kind: 'pending', reason: 'execution' });
  older.release(); expect(older.finalize()).toMatchObject({ kind: 'finalized' });
  const g = absenceFixture(); g.adopt(); g.release(); g.ingest();
  expect(g.finalize()).toEqual({ kind: 'pending', reason: 'events' }); g.confirm();
  const h = absenceFixture(); h.adopt(); h.release({ lastSeq: 3 }); h.ingest(); h.confirm();
  const before = h.facts(); expect(() => h.finalize()).toThrow(); expect(h.facts()).toEqual(before);
});

it('creates exact zero cursor and rejects mismatched admission, scope, digest and physical UUID', () => {
  const f = absenceFixture({ end: 0 });
  f.ready(); expect(f.finalize()).toMatchObject({ kind: 'finalized', receipt: { finalAgentSeq: 0, retainedPayloadBytes: 0, refundedBytes: 10000 } });
  expect(f.db.prepare('SELECT durable_through,ack_confirmed_through,event_count,retained_bytes FROM event_cursors').get())
    .toEqual({ durable_through: 0, ack_confirmed_through: 0, event_count: 0, retained_bytes: 0 });
  const g = absenceFixture(); g.adopt(); g.release({ admission: { state: 'released', disposition: 'never_started' } }); g.ingest(); g.confirm();
  expect(g.finalize()).toEqual({ kind: 'pending', reason: 'execution' });
  for (const binding of [{ ...g.binding, journalAuthority: uuid(88) }, { ...g.binding, key: { ...g.key, runId: uuid(88) } }]) {
    expect(() => g.absences.execute({ kind: 'absenceRead', binding })).toThrow();
  }
  expect(() => g.absences.execute({ kind: 'absenceFinalize', request: { ...g.command(), proofDigest: 'f'.repeat(64) } })).toThrow();
});

it('requires persisted cancellation intent and makes it win before commit', () => {
  const f = absenceFixture({ reason: 'cancelled' }); f.ready();
  expect(f.finalize()).toEqual({ kind: 'pending', reason: 'execution' });
  f.store.execute({ kind: 'cancelRun', command: prepareCancelRunCommand({ kind: 'cancelRun', id: f.key.runId,
    request: { scope, requestId: requestId() } }, digest) });
  expect(f.finalize()).toMatchObject({ kind: 'finalized', receipt: { state: 'cancelled', reason: 'cancelled', validationStatus: 'pending' } });
});

it('rejects adopted and partial source custody in either direction', () => {
  const source = finalizationFixture(); source.adopt();
  const f = absenceFixture(); f.putManifest();
  expect(() => f.adopt()).toThrow();
  const g = absenceFixture(); g.adopt(); expect(() => g.putManifest()).toThrow();
  expect(() => source.db.prepare(`INSERT INTO execution_output_absences SELECT attempt_id,run_id,organization_id,workspace_id,
    intent_digest,journal_authority,generation,?,final_agent_seq,? FROM execution_output_sources`).run(
      'a'.repeat(64), encodeCanonicalJson({ ...g.proof, ...source.key.attempt }, 2048))).toThrow();
});

it('bounds ordinary capture, snapshots caller data and rejects fake successful projection', () => {
  const f = absenceFixture(); f.ready(); const operation = { kind: 'absenceFinalize' as const, request: f.command() };
  expect(captureAbsenceOperation({ ...operation, messageId: 1 })).toEqual(operation);
  const reply = f.finalize(); expect(captureAbsenceReply(operation, reply)).toEqual(reply);
  if (!reply || !('kind' in reply) || reply.kind !== 'finalized') throw new Error('Missing receipt');
  for (const patch of [{ state: 'finished', outcome: 'passed' }, { validationStatus: 'passed' }, { proofDigest: 'f'.repeat(64) }]) {
    expect(() => captureAbsenceReply(operation, { ...reply, receipt: { ...reply.receipt, ...patch } })).toThrow();
  }
  expect(() => captureAbsenceOperation({ ...operation, padding: 'x'.repeat(4096) })).toThrow();
});

it('retains exact C+R quota and leaves short quota blocked without speculative credit', () => {
  const sample = absenceFixture(); sample.release({ result: sample.value }); sample.ingest();
  const bytes = Number(sample.cursor().retained_bytes) + Buffer.byteLength(encodeCanonicalJson(sample.value, 65536));
  const exact = absenceFixture({ maximum: bytes }); exact.adopt(); exact.release({ result: exact.value }); exact.ingest(); exact.confirm();
  expect(exact.finalize()).toMatchObject({ kind: 'finalized', receipt: { retainedPayloadBytes: bytes, refundedBytes: 0 } });
  const short = absenceFixture({ maximum: bytes - 1 }); short.adopt(); short.release({ result: short.value }); short.ingest();
  const before = short.usage(); expect(short.finalize()).toEqual({ kind: 'pending', reason: 'events' });
  expect(short.usage()).toBe(before); expect(short.cursor().blocked_reason).toBe('quota_exhausted');
});

it('keeps missing and explicitly gapped event custody pending', () => {
  const f = absenceFixture(); f.adopt(); f.release();
  expect(f.finalize()).toEqual({ kind: 'pending', reason: 'events' });
  f.events.recordProblem({ binding: f.binding, after: 0, kind: 'cursor_expired', retainedStartSeq: 3 });
  expect(f.finalize()).toEqual({ kind: 'pending', reason: 'events' });
});

it('current charged header cannot close execution or release retained output budget', () => {
  const f = absenceFixture(); f.adopt();
  f.observe({ state: 'exited', lastSeq: 2, admission: { state: 'charged' } }); f.ingest(); f.confirm();
  const before = f.facts(); expect(f.finalize()).toEqual({ kind: 'pending', reason: 'execution' }); expect(f.facts()).toEqual(before);
});
