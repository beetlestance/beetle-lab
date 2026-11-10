import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { initialize } from '../../src/journal/schema.js';
import { migration008 } from '../../src/journal/migration008.js';
import { migration009 } from '../../src/journal/migration009.js';
import { migration010 } from '../../src/journal/migration010.js';
import { transaction } from '../../src/journal/sql.js';
import { journalFixture } from './fixtures.js';

const f = journalFixture();
function old(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  db.exec(readFileSync('agent/test/journal/v7-fixture.sql', 'utf8'));
  transaction(db, () => { db.exec(migration008); db.exec(migration009); db.exec('INSERT INTO journal_authority VALUES(1,NULL)'); });
  return db;
}
function durable(db: DatabaseSync) {
  return ['accepted_attempts', 'event_spool', 'admission_settings', 'admission_queue', 'reservations',
    'supervision_clock', 'journal_authority', 'sqlite_sequence'].map(table => ({ table, rows: db.prepare(`SELECT * FROM ${table}`).all() }));
}

it('preserves v9 quarantine and all old ownership bytes without backfilling fresh refusal', async () => {
  const path = f.path(); const seed = old(path);
  seed.exec('UPDATE admission_settings SET observation_json=NULL'); const before = durable(seed); seed.close();
  for (let count = 0; count < 2; count++) {
    const db = initialize(path);
    try {
      expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(10);
      expect(durable(db)).toEqual(before);
      expect(db.prepare('SELECT * FROM cancelled_originals').all()).toEqual([]);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { db.close(); }
  }
  const journal = await f.open(path);
  await expect(journal.journalAuthority()).rejects.toMatchObject({ code: 'recovery_required' });
});

it('preserves fresh v9 UUID and an unknown original when upgrading then cancelling', async () => {
  const path = f.path(); let journal = await f.open(path); const authority = await journal.journalAuthority();
  await journal.immutableOffer(f.offer()); await f.close(journal);
  const seed = new DatabaseSync(path); seed.exec('DROP TABLE cancelled_originals; PRAGMA user_version=9'); seed.close();
  journal = await f.open(path);
  expect(await journal.journalAuthority()).toBe(authority);
  expect(await journal.cancelOriginal({ offer: f.offer(), now: 1000 })).not.toHaveProperty('admission');
  await f.close(journal);
  const db = new DatabaseSync(path);
  try { expect(db.prepare('SELECT * FROM cancelled_originals').all()).toEqual([]); }
  finally { db.close(); }
});

it('retains immutable FK-bound marker even with REPLACE and recursive triggers disabled', async () => {
  const path = f.path(); const journal = await f.open(path); await journal.cancelOriginal({ offer: f.offer(), now: 1000 }); await f.close(journal);
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  try {
    db.exec('PRAGMA recursive_triggers=OFF');
    const before = db.prepare('SELECT * FROM cancelled_originals').all();
    for (const sql of [
      'UPDATE cancelled_originals SET generation=1', 'DELETE FROM cancelled_originals',
      'INSERT OR REPLACE INTO cancelled_originals SELECT * FROM cancelled_originals',
      'INSERT OR IGNORE INTO cancelled_originals SELECT * FROM cancelled_originals',
    ]) { expect(() => db.exec(sql)).toThrow('immutable cancelled original'); expect(db.prepare('SELECT * FROM cancelled_originals').all()).toEqual(before); }
    expect(() => db.exec("INSERT INTO cancelled_originals VALUES ('orphan',1)")).toThrow();
    expect(() => db.exec('INSERT INTO cancelled_originals VALUES (NULL,1)')).toThrow();
    expect(() => db.exec('DELETE FROM accepted_attempts')).toThrow();
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});

it('atomically rolls back schema10, triggers, old rows and version on late migration and deferred commit failure', () => {
  const db = old(f.path()); const before = durable(db);
  try {
    db.exec('CREATE TABLE parent(id PRIMARY KEY); CREATE TABLE child(id REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)');
    for (const fault of ['INSERT INTO missing_table VALUES(1)', 'INSERT INTO child VALUES(1)']) {
      expect(() => transaction(db, () => { db.exec(migration010); db.exec(fault); })).toThrow();
      expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(9);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%cancelled_originals%'").all()).toEqual([]);
      expect(durable(db)).toEqual(before);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    }
  } finally { db.close(); }
});

it('initialization checks migrated v9 foreign keys and rolls back marker schema on corruption', () => {
  const path = f.path(); const seed = old(path);
  seed.exec('PRAGMA foreign_keys=OFF; DELETE FROM accepted_attempts'); seed.close();
  expect(() => initialize(path)).toThrow('unavailable');
  const db = new DatabaseSync(path);
  try {
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(9);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%cancelled_originals%'").all()).toEqual([]);
  } finally { db.close(); }
});
