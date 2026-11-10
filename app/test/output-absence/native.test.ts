import { OutputAbsences } from '../../src/adapters/outbound/sqlite/output-absence/index.js';
import { hash } from '../storage/output-payload-fixtures.js';
import { expect, it } from 'vitest';
import { encodeCanonicalJson } from '@beetle/contracts';
import { absenceFixture } from './fixture.js';
import { finalizationFixture } from '../output-finalization/fixture.js';
import { ack, request } from '../storage/events/fixtures.js';
const receiptSelect = `SELECT attempt_id,run_id,organization_id,workspace_id,intent_digest,journal_authority,generation,
 proof_digest,final_agent_seq,retained_payload_bytes,maximum_payload_bytes-retained_payload_bytes,run_version,state,outcome,validation_status,reason
 FROM output_absence_evidence`;
it('native receipt validates end/admission/events/credit and rolls back failure atomically', () => {
  const f = absenceFixture(); f.adopt(); f.release(); f.ingest();
  expect(() => f.db.exec(`INSERT INTO execution_output_absence_finalizations ${receiptSelect}`)).toThrow();
  f.confirm(); const before = f.facts();
  for (const select of [receiptSelect.replace('retained_payload_bytes,maximum', 'retained_payload_bytes+1,maximum'),
    receiptSelect.replace(',run_version,state', ',run_version+1,state'), receiptSelect.replace(',state,outcome', ",'cancelled',outcome")]) {
    expect(() => f.db.exec(`INSERT INTO execution_output_absence_finalizations ${select}`)).toThrow(); expect(f.facts()).toEqual(before);
  }
  f.db.exec("CREATE TRIGGER synthetic_abort BEFORE UPDATE OF event_pending ON execution_records BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
  expect(() => f.finalize()).toThrow(); expect(f.facts()).toEqual(before);
  expect(f.db.prepare('SELECT count(*) n FROM execution_output_absence_finalizations').get()?.n).toBe(0);
  f.db.exec('DROP TRIGGER synthetic_abort'); expect(f.finalize()).toMatchObject({ kind: 'finalized' });
});
it('native proof enforces canonical digest/identity, source exclusion and retained INSERT/REPLACE', () => {
  const f = absenceFixture(); f.adopt();
  for (const sql of ['INSERT INTO execution_output_absences SELECT * FROM execution_output_absences',
    'INSERT OR REPLACE INTO execution_output_absences SELECT * FROM execution_output_absences',
    'UPDATE execution_output_absences SET final_agent_seq=final_agent_seq', 'DELETE FROM execution_output_absences']) {
    expect(() => f.db.exec(sql)).toThrow();
  }
  const g = absenceFixture();
  const insert = `INSERT INTO execution_output_absences SELECT attempt_id,run_id,organization_id,workspace_id,intent_digest,journal_authority,
    acknowledged_generation,?,2,? FROM execution_records`;
  for (const text of [JSON.stringify(g.proof), encodeCanonicalJson({ ...g.proof, admission: { state: 'rejected', reason: 'per_run_ceiling' }, reason: 'artifact_incomplete' }, 2048),
    encodeCanonicalJson({ ...g.proof, journalAuthority: '11111111-1111-4111-8111-111111111111' }, 2048)]) {
    expect(() => g.db.prepare(insert).run(hash(text), text)).toThrow();
  }
  expect(() => f.putManifest()).toThrow();
});
it('blocks REPLACE, terminal fabrication, later evidence/slots/payload/events and reopening after receipt', () => {
  const f = absenceFixture(); f.adopt(); f.release({ result: f.value }); f.ingest(); f.confirm(); f.finalize();
  const before = f.facts();
  for (const sql of ['INSERT OR REPLACE INTO execution_output_absence_finalizations SELECT * FROM execution_output_absence_finalizations',
    'UPDATE execution_output_absence_finalizations SET refunded_bytes=refunded_bytes', 'DELETE FROM execution_output_absence_finalizations',
    'UPDATE execution_records SET event_pending=1', 'UPDATE execution_records SET snapshot_json=snapshot_json||\' \'' ,
    'UPDATE execution_records SET result_observed=0', "UPDATE runs SET state='finished',outcome='passed'", 'UPDATE runs SET version=version+1',
    'UPDATE event_cursors SET ack_confirmed_through=ack_confirmed_through', 'UPDATE execution_output_payloads SET canonical_json=canonical_json',
    "INSERT OR REPLACE INTO execution_output_payloads SELECT * FROM execution_output_payloads",
    "INSERT INTO execution_output_slots SELECT attempt_id,0,'{}' FROM execution_records"]) {
    expect(() => f.db.exec(sql)).toThrow(); expect(f.facts()).toEqual(before);
  }
  expect(() => f.events.ingest(request(f.binding, 2, 1))).toThrow();
  expect(f.facts()).toEqual(before);
});
it.each(['source', 'absence'] as const)('late full ACK for %s receipt is a read-only point recognition', family => {
  const f = family === 'source' ? finalizationFixture() : absenceFixture(); f.ready(); f.finalize();
  const before = f.facts();
  f.db.exec("CREATE TRIGGER synthetic_readonly BEFORE UPDATE ON event_cursors BEGIN SELECT RAISE(ABORT,'no writes'); END;");
  expect(f.events.confirmAck({ binding: f.binding, throughSeq: 2, receipt: ack(f.binding, 2) })).toMatchObject({ durableThrough: 2, ackConfirmedThrough: 2 });
  expect(() => f.events.confirmAck({ binding: f.binding, throughSeq: 1, receipt: ack(f.binding, 1) })).toThrow();
  expect(f.facts()).toEqual(before);
});
it('uses indexed point facts without scanning retained history', () => {
  const f = absenceFixture(); f.ready();
  const plan = f.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM output_absence_evidence WHERE attempt_id=?').all(f.key.attempt.attemptId);
  expect(plan.some(row => String(row.detail).includes('SEARCH e USING INDEX'))).toBe(true);
  expect(plan.some(row => String(row.detail).includes('SCAN e'))).toBe(false);
});
it('absence identity point read rejects source custody without materializing or parsing source bodies', () => {
  const f = finalizationFixture(); f.adopt();
  // Make any accidental source-envelope materialization fail, retaining source identity.
  const triggers = f.db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='execution_output_payloads'").all();
  for (const row of triggers) {
    if (typeof row.name !== 'string' || !/^[a-z0-9_]+$/.test(row.name)) throw new Error('Unsafe synthetic trigger');
    f.db.exec(`DROP TRIGGER ${row.name}`);
  }
  f.db.prepare("UPDATE execution_output_payloads SET canonical_json='{}'").run();
  expect(() => new OutputAbsences(f.db).execute({ kind: 'absenceRead', binding: f.binding })).toThrowError('Storage conflict');
});
