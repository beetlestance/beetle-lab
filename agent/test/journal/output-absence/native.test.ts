import { expect, it } from 'vitest';
import { absenceFixture, insert, json } from './fixtures.js';
import { now, scope } from '../../admission/fixtures.js';

const f = absenceFixture();

it.each([false, true])('native closure validates physical scope, reason, admission and exact charge for fresh=%s', async fresh => {
  const { db, proof } = await f.ready(fresh);
  for (const changed of [
    { journalAuthority: '00000000-0000-4000-8000-000000000099' }, { organizationId: '00000000-0000-4000-8000-000000000099' },
    { finalAgentSeq: proof.finalAgentSeq + 1 }, { reason: 'timeout' }, { admission: { state: 'charged' } }, { version: 2 },
  ]) expect(() => insert(db, { ...proof, ...changed } as typeof proof)).toThrow();
  expect(() => insert(db, proof, 'INSERT', Buffer.byteLength(json(proof)) + 255)).toThrow();
  insert(db, proof);
  expect(db.prepare('SELECT absence_bytes,absence_pending FROM accepted_attempts').get())
    .toEqual({ absence_bytes: Buffer.byteLength(json(proof)) + 256, absence_pending: 0 });
  for (const verb of ['INSERT', 'INSERT OR REPLACE', 'REPLACE']) expect(() => insert(db, proof, verb)).toThrow();
  for (const sql of ['UPDATE output_absence_closures SET proof_json=proof_json', 'DELETE FROM output_absence_closures',
    'UPDATE accepted_attempts SET absence_bytes=0', 'UPDATE accepted_attempts SET absence_pending=1', 'DELETE FROM accepted_attempts']) {
    expect(() => db.exec(sql)).toThrow();
  }
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

it('freezes stream/projection and producer tables against native late writes while allowing ACK/prune', async () => {
  const { db, proof, store, key } = await f.ready(); insert(db, proof);
  const event = db.prepare('SELECT * FROM event_spool').get()!;
  const before = db.prepare('SELECT * FROM output_absence_closures').all();
  for (const [column, value] of [['last_seq', 'last_seq+1'], ['supervisor_high', 'supervisor_high+1'], ['wrapper_high', 'wrapper_high+1'],
    ['state', "'running'"], ['phase', "'seal'"], ['result_json', "'{}'"], ['exit_facts_json', "'{}'"],
    ['exit_json', "'{}'"], ['wrapper_checkpoint_json', "'{}'"], ['organization_id', "'different'"], ['snapshot_bytes', 'snapshot_bytes+1'],
    ['checkpoint_bytes', 'checkpoint_bytes+1']]) {
    expect(() => db.exec(`UPDATE accepted_attempts SET ${column}=${value}`)).toThrow();
  }
  expect(() => db.prepare(`INSERT OR REPLACE INTO event_spool(${Object.keys(event).join(',')})
    VALUES(${Object.keys(event).map(() => '?').join(',')})`).run(...Object.values(event))).toThrow();
  expect(() => db.exec('UPDATE event_spool SET event_json=event_json')).toThrow();
  expect(() => db.exec('DELETE FROM event_spool')).toThrow();
  expect(() => db.exec("UPDATE reservations SET reservation_json=json_set(reservation_json,'$.createToken','late')")).toThrow();
  expect(() => db.exec("UPDATE admission_queue SET pending=1")).toThrow();
  expect(() => db.exec("UPDATE accepted_attempts SET quota_bytes=1024,spool_bytes=quota_bytes")).toThrow();
  store.execute({ id: 1, kind: 'ack', ack: { protocolVersion: '1.0', ...key, throughSeq: 1 } });
  expect(store.execute({ id: 2, kind: 'prune', key })).toMatchObject({ pruned: 1 });
  expect(store.execute({ id: 3, kind: 'outputAbsenceRead', key })).toEqual(proof);
  expect(db.prepare('SELECT * FROM output_absence_closures').all()).toEqual(before);
});

it('does not authorize zero-event unknown originals or unretired/charged launch facts through raw INSERT', async () => {
  const path = f.path(); const journal = await f.configured(path); const offer = f.job(); const key = scope(offer);
  await journal.immutableOffer(offer); const authority = await journal.journalAuthority();
  await f.close(journal);
  const db = (await import('../../../src/journal/schema.js')).initialize(path);
  try {
    const proof = { version: 1 as const, ...key, generation: 1 as const, journalAuthority: authority, intentDigest: offer.intentDigest,
      finalAgentSeq: 0, admission: { state: 'rejected' as const, reason: 'cancelled' as const }, reason: 'cancelled' as const };
    expect(() => insert(db, proof)).toThrow();
    expect(db.prepare('SELECT absence_pending FROM accepted_attempts').get()?.absence_pending).toBe(0);
  } finally { db.close(); }
  const charged = await f.configured(); const job = f.job(2);
  await f.enqueue(charged, job, now); await f.admit(charged, job, now);
  expect(await charged.closeOutputAbsence(scope(job))).toBeNull();
});

it('enforces exact/one-byte-short quota in both native and worker transaction, preserving debt on failure', async () => {
  const { db, proof, store, key } = await f.ready();
  const used = Number(db.prepare(`SELECT spool_bytes+snapshot_bytes+checkpoint_bytes+hold_bytes+collection_bytes+source_bytes+delivery_bytes AS n
    FROM accepted_attempts`).get()?.n);
  const exact = used + Buffer.byteLength(json(proof)) + 256;
  db.prepare('UPDATE accepted_attempts SET quota_bytes=?').run(exact - 1);
  expect(() => insert(db, proof)).toThrow();
  expect(() => store.execute({ id: 1, kind: 'outputAbsenceClose', key })).toThrow('quota_exceeded');
  expect(db.prepare('SELECT absence_pending,absence_bytes FROM accepted_attempts').get()).toEqual({ absence_pending: 1, absence_bytes: 0 });
  db.prepare('UPDATE accepted_attempts SET quota_bytes=?').run(exact);
  expect(store.execute({ id: 2, kind: 'outputAbsenceClose', key })).toEqual(proof);
  expect(() => db.prepare('UPDATE accepted_attempts SET quota_bytes=?').run(exact - 1)).toThrow();
});

it('supports a definitive historical never-started original with a zero-event end', async () => {
  const { db, store, proof, key } = await f.ready();
  db.exec(`DELETE FROM event_spool; UPDATE accepted_attempts SET state='offered',last_seq=0,supervisor_high=0,
    spool_bytes=0,spool_rows=0;`);
  const zero = { ...proof, finalAgentSeq: 0 };
  insert(db, zero);
  expect(store.execute({ id: 1, kind: 'outputAbsenceRead', key })).toEqual(zero);
  expect(store.execute({ id: 2, kind: 'prune', key })).toMatchObject({ pruned: 0 });
  expect(db.prepare('SELECT phase FROM disk_holds').get()?.phase).toBe('retained');
});
