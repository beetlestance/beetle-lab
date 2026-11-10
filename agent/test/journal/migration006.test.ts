import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { journalFixture } from './fixtures.js';
import { removeFutureRetention } from './legacy-fixtures.js';
const f = journalFixture();
function edit<T>(path: string, work: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path); try { return work(db); } finally { db.close(); }
}
function v5(db: DatabaseSync): void {
  removeFutureRetention(db);
  db.exec(`DROP TABLE cancelled_originals; DROP TABLE journal_authority; ALTER TABLE accepted_attempts DROP COLUMN checkpoint_bytes;
    ALTER TABLE accepted_attempts DROP COLUMN wrapper_checkpoint_json;
    CREATE TABLE event_spool_v5 (
      attempt_id TEXT NOT NULL REFERENCES accepted_attempts(attempt_id),
      generation INTEGER NOT NULL CHECK(generation=1), seq INTEGER NOT NULL CHECK(seq>0),
      source TEXT NOT NULL CHECK(source IN ('wrapper','agent')),
      source_key INTEGER NOT NULL CHECK(source_key BETWEEN 1 AND 9007199254740991),
      canonical_json TEXT NOT NULL CHECK(length(CAST(canonical_json AS BLOB))<=65536),
      event_json TEXT NOT NULL CHECK(length(CAST(event_json AS BLOB))<=65536),
      encoded_bytes INTEGER NOT NULL CHECK(encoded_bytes BETWEEN 1 AND 65536),
      charged_bytes INTEGER NOT NULL CHECK(charged_bytes=encoded_bytes+length(CAST(canonical_json AS BLOB))+256),
      PRIMARY KEY(attempt_id,generation,seq), UNIQUE(attempt_id,generation,source,source_key)
    );
    INSERT INTO event_spool_v5 SELECT * FROM event_spool; DROP TABLE event_spool;
    ALTER TABLE event_spool_v5 RENAME TO event_spool;
    ALTER TABLE supervision_clock DROP COLUMN cancel_reason;
    ALTER TABLE supervision_clock DROP COLUMN stop_immediate; PRAGMA user_version=5;`);
}
it('preserves complete v5 retained rows, snapshots, clocks, ACK and source counters while widening only enrichment storage', async () => {
  const path = f.path(); let journal = await f.open(path); await journal.immutableOffer(f.offer());
  await journal.appendWrapper(f.wrapper(1)); await journal.appendSupervisor(f.supervisor());
  await journal.acknowledge(f.ack(1)); await f.close(journal);
  const before = edit(path, db => { v5(db); return { row: db.prepare('SELECT * FROM accepted_attempts').get(),
    events: db.prepare('SELECT * FROM event_spool ORDER BY seq').all() }; });
  journal = await f.open(path); expect(await journal.readWrapperCheckpoint(f.key())).toBeNull();
  expect(await journal.sourceCursors(f.key())).toEqual({ wrapperSeq: 1, supervisorOrdinal: 1 });
  expect(await journal.get(f.key())).toMatchObject({ state: 'running', phase: 'execute', lastSeq: 2 });
  await f.close(journal);
  edit(path, db => {
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(12);
    expect(db.prepare('SELECT * FROM accepted_attempts').get()).toMatchObject({ ...before.row, wrapper_checkpoint_json: null, checkpoint_bytes: 0 });
    expect(db.prepare('SELECT * FROM event_spool ORDER BY seq').all()).toEqual(before.events);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    const schema = String(db.prepare("SELECT sql FROM sqlite_master WHERE name='event_spool'").get()?.sql);
    expect(schema).toContain('66048');
  });
});
it('rolls back checkpoint columns and child-table changes on a late v6 migration fault', async () => {
  const path = f.path(); const journal = await f.open(path); await journal.immutableOffer(f.offer());
  await journal.appendWrapper(f.wrapper(1)); await f.close(journal);
  const before = edit(path, db => { v5(db); db.exec('CREATE TABLE event_spool_v6(canary TEXT);');
    return db.prepare('SELECT * FROM event_spool').all(); });
  await expect(f.open(path)).rejects.toMatchObject({ code: 'unavailable' });
  edit(path, db => {
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(5);
    expect(db.prepare('SELECT * FROM event_spool').all()).toEqual(before);
    expect(db.prepare('PRAGMA table_info(accepted_attempts)').all().map(row => row.name)).not.toContain('wrapper_checkpoint_json');
    expect(db.prepare('PRAGMA table_info(accepted_attempts)').all().map(row => row.name)).not.toContain('checkpoint_bytes');
  });
});
