import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { initialize } from '../../src/journal/schema.js';
import { cancelOriginal } from '../../src/journal/cancel-original.js';
import { offerInput } from '../../src/journal/input.js';
import { admissionFixture, now, scope } from '../admission/fixtures.js';

const f = admissionFixture();
function edit(path: string, sql: string): void {
  const db = new DatabaseSync(path);
  try { db.exec(sql); } finally { db.close(); }
}
function empty(path: string): void {
  const db = new DatabaseSync(path);
  try {
    for (const table of ['accepted_attempts', 'supervision_clock', 'cancelled_originals', 'admission_queue', 'reservations', 'event_spool']) {
      expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
    }
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
}

it.each([
  'AFTER INSERT ON accepted_attempts',
  'AFTER UPDATE OF cancel_requested ON accepted_attempts',
  'AFTER INSERT ON supervision_clock',
  'AFTER INSERT ON cancelled_originals',
])('rolls back every fresh write when a failure occurs %s', async boundary => {
  const path = f.path(); const seed = await f.open(path); await f.close(seed);
  edit(path, `CREATE TRIGGER synthetic_fault ${boundary} BEGIN SELECT RAISE(ABORT,'synthetic fault'); END;`);
  const journal = await f.open(path);
  await expect(journal.cancelOriginal({ offer: f.offer(), now })).rejects.toMatchObject({ code: 'unavailable' });
  await journal.abort(); empty(path);
  edit(path, 'DROP TRIGGER synthetic_fault');
  const reopened = await f.open(path);
  expect((await reopened.cancelOriginal({ offer: f.offer(), now })).admission).toEqual({ state: 'rejected', reason: 'cancelled' });
});

it('rolls back receipt, cancel, supervision and marker when final snapshot validation fails', async () => {
  const path = f.path(); const seed = await f.open(path); await f.close(seed);
  edit(path, `CREATE TRIGGER synthetic_contradiction AFTER INSERT ON cancelled_originals
    BEGIN UPDATE accepted_attempts SET phase='execute' WHERE attempt_id=NEW.attempt_id; END;`);
  const journal = await f.open(path);
  await expect(journal.cancelOriginal({ offer: f.offer(), now })).rejects.toMatchObject({ code: 'unavailable' });
  await journal.abort(); empty(path);
});

it('rolls back pending retirement with cancellation when its queue update fails', async () => {
  const path = f.path(); let journal = await f.configured(path); const offer = f.job(); await f.enqueue(journal, offer);
  await f.close(journal);
  edit(path, "CREATE TRIGGER synthetic_queue AFTER UPDATE ON admission_queue BEGIN SELECT RAISE(ABORT,'synthetic'); END;");
  journal = await f.open(path);
  await expect(journal.cancelOriginal({ offer, now })).rejects.toMatchObject({ code: 'unavailable' });
  await journal.abort(); edit(path, 'DROP TRIGGER synthetic_queue');
  journal = await f.open(path);
  expect(await journal.get(scope(offer))).toMatchObject({ cancelRequested: false, admission: { state: 'queued' } });
  expect(await journal.supervision({ key: scope(offer), now })).toMatchObject({ cancelRequested: false, cancelRequestedAt: null });
});

it.each([
  'UPDATE accepted_attempts SET cancel_requested=0',
  "UPDATE accepted_attempts SET state='running'",
  "UPDATE accepted_attempts SET phase='execute'",
  'UPDATE accepted_attempts SET last_seq=1',
  'UPDATE accepted_attempts SET wrapper_high=1',
  'UPDATE accepted_attempts SET supervisor_high=1',
  'PRAGMA ignore_check_constraints=ON; UPDATE accepted_attempts SET checkpoint_bytes=1',
  "UPDATE accepted_attempts SET result_json='{}'",
  "UPDATE accepted_attempts SET exit_facts_json='{}'",
  "PRAGMA ignore_check_constraints=ON; UPDATE accepted_attempts SET wrapper_checkpoint_json='{}'",
  "UPDATE supervision_clock SET cancel_reason='timeout'",
  'DELETE FROM supervision_clock',
  `INSERT INTO event_spool(attempt_id,generation,seq,source,source_key,canonical_json,event_json,encoded_bytes,charged_bytes)
    SELECT attempt_id,1,1,'agent',1,'{}','{}',2,260 FROM accepted_attempts`,
  "INSERT INTO admission_queue(attempt_id,candidate_json,pending) SELECT attempt_id,'{}',0 FROM accepted_attempts",
  "INSERT INTO reservations(attempt_id,reservation_json,charged) SELECT attempt_id,'{}',1 FROM accepted_attempts",
])('fails closed on fresh-marker contradiction: %s', async damage => {
  const path = f.path(); const seed = await f.open(path);
  await seed.cancelOriginal({ offer: f.offer(), now }); await f.close(seed); edit(path, damage);
  const journal = await f.open(path);
  await expect(journal.get(f.key())).rejects.toMatchObject({ code: 'unavailable' }); await journal.abort();
  const list = await f.open(path);
  await expect(list.listOpen({ limit: 1 })).rejects.toMatchObject({ code: 'unavailable' });
});

it('denies admission/ownership before any effect when a marker coexists with reservation corruption', async () => {
  const path = f.path(); const seed = await f.open(path);
  await seed.cancelOriginal({ offer: f.offer(), now }); await f.close(seed);
  edit(path, "INSERT INTO reservations(attempt_id,reservation_json,charged) SELECT attempt_id,'{}',1 FROM accepted_attempts");
  const journal = await f.open(path);
  await expect(journal.admission({ kind: 'admit', key: f.key(), now, sourceOrdinal: 1 })).rejects.toMatchObject({ code: 'unavailable' });
  await journal.abort();
  const reopened = await f.open(path);
  await expect(reopened.admission({ kind: 'claimCreate', key: f.key(), specDigest: 'b'.repeat(64) }))
    .rejects.toMatchObject({ code: 'unavailable' });
});

it('denies native event creation on a fresh refusal without changing the receipt', async () => {
  const journal = await f.open(); const initial = await journal.cancelOriginal({ offer: f.offer(), now });
  await expect(journal.appendWrapper(f.wrapper())).rejects.toMatchObject({ code: 'conflict' });
  await expect(journal.appendSupervisor(f.supervisor())).rejects.toMatchObject({ code: 'conflict' });
  expect(await journal.get(f.key())).toEqual(initial);
});

it('fails a bounded disk-full original write without leaving partial refusal authority', () => {
  const path = f.path(); const db = initialize(path);
  try {
    const pages = Number(db.prepare('PRAGMA page_count').get()?.page_count);
    db.exec(`PRAGMA max_page_count=${pages}`);
    const offer = f.offer(); offer.config = { payload: 'x'.repeat(900_000) };
    expect(() => cancelOriginal(db, { ...offerInput(offer), now }, 67_108_864)).toThrow();
    for (const table of ['accepted_attempts', 'supervision_clock', 'cancelled_originals']) {
      expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
    }
  } finally { db.close(); }
});
