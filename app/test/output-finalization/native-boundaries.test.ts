import { expect, it } from 'vitest';
import { finalizationFixture, artifact } from './fixture.js';
import { ack, request } from '../storage/events/fixtures.js';
import { guardsOff } from '../run-results/fixture.js';

const insert = `INSERT INTO execution_output_finalizations SELECT attempt_id,run_id,organization_id,workspace_id,intent_digest,
 journal_authority,generation,source_digest,manifest_digest,final_agent_seq,retained_payload_bytes,
 maximum_payload_bytes-retained_payload_bytes,run_version,state,outcome,validation_status,reason
 FROM output_finalization_evidence WHERE attempt_id=?`;

it('native insertion cannot bypass settled release, full ACK, complete publication or persisted cancellation projection', () => {
  const release = finalizationFixture(); release.adopt(); release.ingest(); release.confirm();
  const debt = finalizationFixture(); debt.adopt(); debt.release(); debt.ingest();
  const publication = finalizationFixture({ artifacts: [artifact] }); publication.ready();
  const cancelled = finalizationFixture(); cancelled.ready(); cancelled.db.exec('UPDATE runs SET cancellation_requested=1,version=version+1');
  for (const f of [release, debt, publication]) {
    const before = f.facts();
    expect(() => f.db.prepare(insert).run(f.key.attempt.attemptId)).toThrow();
    expect(f.facts()).toEqual(before);
    expect(f.db.prepare('SELECT count(*) n FROM execution_output_finalizations').get()?.n).toBe(0);
  }
  const before = cancelled.facts();
  expect(() => cancelled.db.prepare(insert.replace(',run_version,state,outcome,validation_status,reason',
    ",run_version,'finished','passed','passed',NULL")).run(cancelled.key.attempt.attemptId)).toThrow();
  expect(cancelled.facts()).toEqual(before);
});

it('requires the exact full event end and permits only an existing full ACK after closure', () => {
  const f = finalizationFixture({ events: 3 }); f.adopt(); f.release();
  f.events.ingest(request(f.binding)); f.events.confirmAck({ binding: f.binding, throughSeq: 1, receipt: ack(f.binding, 1) });
  expect(f.finalize()).toEqual({ kind: 'pending', reason: 'events' });
  f.events.ingest(request(f.binding, 1, 2));
  expect(f.finalize()).toEqual({ kind: 'pending', reason: 'events' });
  f.confirm(); expect(f.finalize().kind).toBe('finalized'); const before = f.facts();
  expect(f.events.confirmAck({ binding: f.binding, throughSeq: 1, receipt: ack(f.binding, 3) })).toMatchObject({ ackConfirmedThrough: 3 });
  expect(() => f.events.confirmAck({ binding: f.binding, throughSeq: 1, receipt: ack(f.binding, 1) })).toThrow();
  const event = f.event();
  expect(() => f.db.prepare('INSERT INTO run_events VALUES(?,1,4,?,?,?)')
    .run(f.key.attempt.attemptId, event.canonical, event.chargedBytes, Number(f.cursor().retained_bytes) + event.chargedBytes)).toThrow();
  expect(() => f.db.prepare(`INSERT OR REPLACE INTO event_cursors(attempt_id,run_id,organization_id,workspace_id,intent_digest,journal_authority,generation)
    VALUES(?,?,?,?,?,?,1)`).run(f.key.attempt.attemptId, f.key.runId, f.key.attempt.organizationId,
      f.key.attempt.workspaceId, f.key.attempt.intentDigest, f.binding.journalAuthority)).toThrow();
  expect(f.facts()).toEqual(before);
});

it('rejects unsafe accounting, missing/extra slots and corrupt publication identities without credit', () => {
  const f = finalizationFixture(); f.ready();
  const before = f.facts();
  for (const invalid of ['9007199254740992', '-1', '0.5']) {
    expect(() => f.db.prepare(insert.replace('retained_payload_bytes,', `${invalid},`)).run(f.key.attempt.attemptId)).toThrow();
    expect(f.facts()).toEqual(before);
  }
  const missing = finalizationFixture({ artifacts: [artifact] }); missing.ready();
  guardsOff(missing.db, 'execution_output_slots'); missing.db.exec('DELETE FROM execution_output_slots');
  expect(() => missing.finalize()).toThrow();
  const extra = finalizationFixture(); extra.ready(); guardsOff(extra.db, 'execution_output_slots');
  extra.db.prepare('INSERT INTO execution_output_slots VALUES(?,0,?)').run(extra.key.attempt.attemptId,
    JSON.stringify({ v: 1, t: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', o: 0, p: 'published', i: 'd'.repeat(64), w: null }));
  expect(() => extra.finalize()).toThrow();
  const corrupt = finalizationFixture({ artifacts: [artifact] }); corrupt.ready(); guardsOff(corrupt.db, 'execution_output_slots');
  corrupt.db.exec("UPDATE execution_output_slots SET slot_json=json_set(slot_json,'$.p','published','$.o',32,'$.i','not-a-digest')");
  expect(() => corrupt.finalize()).toThrow();
  for (const value of [missing, extra, corrupt]) {
    expect(value.db.prepare('SELECT count(*) n FROM execution_output_finalizations').get()?.n).toBe(0);
    expect(value.usage()).toBe(141072);
  }
});
