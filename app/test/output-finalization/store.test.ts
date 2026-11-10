import { expect, it } from 'vitest';
import { encodeCanonicalJson } from '@beetle/contracts';
import { finalizationFixture, artifact, uuid } from './fixture.js';
import { ack, request } from '../storage/events/fixtures.js';
import { guardsOff } from '../run-results/fixture.js';

it('settles verified source custody once, independently counts retained bytes, preserves original history and indexed discovery', () => {
  const f = finalizationFixture(); f.ready(); const before = f.usage(); const allocation = f.db.prepare('SELECT * FROM attempt_output_allocations').get();
  const original = f.command(); const result = f.finalize(); expect(result.kind).toBe('finalized');
  if (result.kind !== 'finalized') throw new Error('Missing finalization');
  const eventBytes = f.db.prepare('SELECT sum(charged_bytes) bytes FROM run_events').get()?.bytes;
  const retained = Number(eventBytes) + Buffer.byteLength(encodeCanonicalJson(f.envelope.manifest, 73728));
  expect(result.receipt).toMatchObject({ state: 'finished', outcome: 'passed', validationStatus: 'passed', reason: null,
    retainedPayloadBytes: retained, refundedBytes: 10000 - retained, runVersion: original.expectedRunVersion + 1 });
  expect(f.usage()).toBe(before - result.receipt.refundedBytes);
  expect(f.db.prepare('SELECT * FROM attempt_output_allocations').get()).toEqual(allocation);
  expect(f.db.prepare('SELECT output_pending,event_pending FROM execution_records').get()).toEqual({ output_pending: 1, event_pending: 0 });
  expect(f.finalizations.execute({ kind: 'outputFinalize', request: { ...original, expectedRunVersion: 1 } })).toEqual(result);
  expect(f.usage()).toBe(before - result.receipt.refundedBytes);
  expect(f.outputs.execute({ kind: 'outputScan', query: { limit: 32 } })).toEqual({ items: [], nextCursor: null });
  expect(f.events.scan({ limit: 32 })).toEqual({ items: [], nextCursor: null });
  expect(f.events.confirmAck({ binding: f.binding, throughSeq: 1, receipt: ack(f.binding, 1) })).toMatchObject({ ackConfirmedThrough: 1 });
  expect(f.outputs.execute({ kind: 'outputReadSource', binding: f.binding })).toEqual(f.envelope);
  const plan = f.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM output_finalization_evidence WHERE attempt_id=?').all(f.key.attempt.attemptId);
  expect(plan.some(row => String(row.detail).includes('SEARCH e USING INDEX'))).toBe(true);
  expect(plan.some(row => String(row.detail).includes('SCAN e'))).toBe(false);
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

it('requires source, actual settled release, exact event prefix and full confirmed ACK before finalization', () => {
  const f = finalizationFixture();
  expect(f.finalize()).toEqual({ kind: 'pending', reason: 'source' });
  f.adopt(); expect(f.finalize()).toEqual({ kind: 'pending', reason: 'execution' });
  f.release(); expect(f.finalize()).toEqual({ kind: 'pending', reason: 'events' });
  f.ingest(); expect(f.finalize()).toEqual({ kind: 'pending', reason: 'events' });
  f.confirm(); expect(f.finalize().kind).toBe('finalized');
  const g = finalizationFixture(); g.adopt(); g.release({ admission: { state: 'released', disposition: 'never_started' } });
  g.ingest(); g.confirm(); expect(g.finalize()).toEqual({ kind: 'pending', reason: 'execution' });
});

it('supports zero artifacts and zero events only with adopted verified source and creates exactly one zero cursor', () => {
  const f = finalizationFixture({ events: 0 }); f.adopt(); f.release();
  expect(f.db.prepare('SELECT count(*) n FROM event_cursors').get()?.n).toBe(0);
  expect(f.finalize()).toMatchObject({ kind: 'finalized', receipt: { finalAgentSeq: 0, state: 'finished' } });
  expect(f.db.prepare('SELECT durable_through,ack_confirmed_through,event_count,retained_bytes FROM event_cursors').get())
    .toEqual({ durable_through: 0, ack_confirmed_through: 0, event_count: 0, retained_bytes: 0 });
});

it('requires published full-sized artifacts with released writer, retains A bytes and rejects corrupt native identities', () => {
  const f = finalizationFixture({ artifacts: [artifact] }); f.ready();
  expect(f.finalize()).toEqual({ kind: 'pending', reason: 'artifacts' });
  const slot = JSON.parse(String(f.db.prepare('SELECT slot_json FROM execution_output_slots').get()?.slot_json)) as Record<string, unknown>;
  const update = (value: object) => f.db.prepare('UPDATE execution_output_slots SET slot_json=?').run(JSON.stringify(value));
  update({ ...slot, v: 2, w: uuid(99) });
  update({ ...slot, v: 3, o: artifact.bytes, i: 'd'.repeat(64), w: uuid(99) });
  update({ ...slot, v: 4, o: artifact.bytes, i: 'd'.repeat(64), w: uuid(99), p: 'publishing' });
  expect(f.finalize()).toEqual({ kind: 'pending', reason: 'artifacts' });
  update({ ...slot, v: 5, o: artifact.bytes, i: 'e'.repeat(64), w: null, p: 'published' });
  expect(f.finalize()).toMatchObject({ kind: 'finalized', receipt: {
    retainedPayloadBytes: Number(f.cursor().retained_bytes) + Buffer.byteLength(encodeCanonicalJson(f.envelope.manifest, 73728)) + artifact.bytes } });
});

it('fails scoped/digest/version mismatches and corrupt source instead of returning a successful or pending fallback', () => {
  const f = finalizationFixture(); f.ready(); const command = f.command();
  for (const patch of [{ expectedRunVersion: 1 }, { sourceDigest: 'a'.repeat(64) }, { manifestDigest: 'a'.repeat(64) }]) {
    expect(() => f.finalizations.execute({ kind: 'outputFinalize', request: { ...command, ...patch } })).toThrow();
  }
  for (const patch of [{ runId: uuid(88) }, { attempt: { ...f.key.attempt, organizationId: uuid(88) } },
    { attempt: { ...f.key.attempt, intentDigest: 'f'.repeat(64) } }]) {
    expect(() => f.finalizations.execute({ kind: 'outputFinalize', request: { ...command,
      binding: { ...f.binding, key: { ...f.key, ...patch } } } })).toThrow();
  }
  expect(() => f.finalizations.execute({ kind: 'outputFinalize', request: { ...command,
    binding: { ...f.binding, journalAuthority: uuid(88) } } })).toThrow();
  guardsOff(f.db, 'execution_output_payloads');
  f.db.prepare("UPDATE execution_output_payloads SET canonical_json=json_set(canonical_json,'$.result.outcome','failed')").run();
  expect(() => f.finalize()).toThrow();
  expect(f.db.prepare('SELECT count(*) n FROM execution_output_finalizations').get()?.n).toBe(0);
});

it('native receipt guards reject fabricated credit/projection, replacement, reopen, late rows and evidence mutation atomically', () => {
  const f = finalizationFixture(); f.ready(); const before = f.facts();
  const select = `SELECT attempt_id,run_id,organization_id,workspace_id,intent_digest,journal_authority,generation,source_digest,
    manifest_digest,final_agent_seq,retained_payload_bytes,maximum_payload_bytes-retained_payload_bytes,run_version,state,outcome,validation_status,reason
    FROM output_finalization_evidence WHERE attempt_id=?`;
  for (const column of ['retained_payload_bytes', 'run_version', 'state', 'outcome']) {
    const changed = select.replace(column === 'state' ? ',state,' : column === 'outcome' ? ',outcome,' : column,
      column === 'state' ? ",'errored'," : column === 'outcome' ? ",'failed'," : `${column}+1`);
    expect(() => f.db.prepare(`INSERT INTO execution_output_finalizations ${changed}`).run(f.key.attempt.attemptId)).toThrow();
    expect(f.facts()).toEqual(before);
  }
  f.db.exec("CREATE TRIGGER synthetic_abort BEFORE UPDATE OF event_pending ON execution_records BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
  expect(() => f.finalize()).toThrow(); expect(f.facts()).toEqual(before);
  expect(f.db.prepare('SELECT count(*) n FROM execution_output_finalizations').get()?.n).toBe(0);
  f.db.exec('DROP TRIGGER synthetic_abort'); f.finalize(); const after = f.facts();
  for (const sql of ['INSERT OR REPLACE INTO execution_output_finalizations SELECT * FROM execution_output_finalizations',
    'INSERT INTO execution_output_finalizations SELECT * FROM execution_output_finalizations',
    'UPDATE execution_output_finalizations SET refunded_bytes=refunded_bytes+1', 'DELETE FROM execution_output_finalizations',
    'UPDATE execution_records SET event_pending=1', "UPDATE execution_records SET snapshot_json=json_set(snapshot_json,'$.lastSeq',3)",
    "UPDATE runs SET state='finalizing',outcome='pending'", 'UPDATE runs SET version=version+1',
    'UPDATE event_cursors SET ack_confirmed_through=ack_confirmed_through',
    'UPDATE execution_output_payloads SET canonical_json=canonical_json']) {
    expect(() => f.db.exec(sql)).toThrow(); expect(f.facts()).toEqual(after);
  }
  expect(() => f.events.ingest(request(f.binding, 1, 1))).toThrow();
  expect(() => f.events.confirmAck({ binding: { ...f.binding, journalAuthority: uuid(88) }, throughSeq: 1, receipt: ack(f.binding, 1) })).toThrow();
  expect(f.facts()).toEqual(after);
});
