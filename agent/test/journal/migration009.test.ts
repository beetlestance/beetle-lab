import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { initialize } from '../../src/journal/schema.js';
import { migration008 } from '../../src/journal/migration008.js';
import { migration009 } from '../../src/journal/migration009.js';
import { readJournalAuthority } from '../../src/journal/authority.js';
import { transaction } from '../../src/journal/sql.js';
import { journalFixture } from './fixtures.js';

const f = journalFixture();
const canonical = '12345678-1234-4abc-8def-123456789abc';
function v8(path: string, empty = false): DatabaseSync {
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  db.exec(readFileSync('agent/test/journal/v7-fixture.sql', 'utf8'));
  transaction(db, () => db.exec(migration008));
  if (empty) db.exec(`DELETE FROM event_spool; DELETE FROM admission_queue; DELETE FROM reservations;
    DELETE FROM supervision_clock; DELETE FROM accepted_attempts;`);
  return db;
}
function definitions(db: DatabaseSync) {
  return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'journal_authority%' ORDER BY name").all();
}
function durableRows(db: DatabaseSync) {
  return ['accepted_attempts', 'event_spool', 'admission_settings', 'admission_queue', 'reservations',
    'supervision_clock', 'sqlite_sequence'].map(table => ({ table, rows: db.prepare(`SELECT * FROM ${table}`).all() }));
}

it.each([false, true])('quarantines old v8 journal (empty=%s) without adopting identity or changing durable rows', async empty => {
  const path = f.path(); const old = v8(path, empty);
  const before = durableRows(old); const graph = definitions(old);
  const settings = before.find(entry => entry.table === 'admission_settings')?.rows[0];
  if (!settings) throw new Error('Missing synthetic settings');
  settings.observation_json = null; old.close();
  for (let count = 0; count < 2; count++) {
    const journal = await f.open(path);
    await expect(journal.journalAuthority()).rejects.toMatchObject({ code: 'recovery_required' });
    await f.close(journal);
    const db = new DatabaseSync(path);
    try {
      expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(9);
      expect(db.prepare('SELECT * FROM journal_authority').all()).toEqual([{ id: 1, authority: null }]);
      expect(durableRows(db)).toEqual(before); expect(definitions(db)).toEqual(graph);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { db.close(); }
  }
});

it.each(['fresh', 'old'])('forbids insert/update/delete/replace of the %s singleton even with recursive triggers off', mode => {
  const path = f.path(); if (mode === 'old') v8(path).close();
  const db = initialize(path);
  try {
    const before = db.prepare('SELECT * FROM journal_authority').all();
    db.exec('PRAGMA recursive_triggers=OFF');
    for (const sql of [
      `UPDATE journal_authority SET authority='${canonical}'`,
      'UPDATE journal_authority SET id=2', 'DELETE FROM journal_authority',
      `INSERT INTO journal_authority VALUES(1,'${canonical}')`,
      `INSERT OR REPLACE INTO journal_authority VALUES(1,'${canonical}')`,
      `REPLACE INTO journal_authority VALUES(1,'${canonical}')`,
      `INSERT OR IGNORE INTO journal_authority VALUES(1,'${canonical}')`,
      `INSERT INTO journal_authority VALUES(1,'${canonical}') ON CONFLICT(id) DO UPDATE SET authority=excluded.authority`,
    ]) {
      expect(() => db.exec(sql)).toThrow('immutable journal authority');
      expect(db.prepare('SELECT * FROM journal_authority').all()).toEqual(before);
    }
  } finally { db.close(); }
});

it.each(['UPPER000-1234-1234-1234-123456789abc', '123456781234-1234-1234-123456789abc',
  '12345678-1234-1234-1234-123456789abé', '12345678-1234-1234-1234-123456789abc\u0000'])('enforces canonical lowercase 36-byte UUIDs in SQL: %s', value => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(migration009);
    expect(() => db.prepare('INSERT INTO journal_authority VALUES(1,?)').run(value)).toThrow();
    expect(() => db.prepare('INSERT INTO journal_authority VALUES(2,?)').run(canonical)).toThrow();
    db.prepare('INSERT INTO journal_authority VALUES(1,?)').run(canonical);
    expect(readJournalAuthority(db)).toBe(canonical);
  } finally { db.close(); }
});

it('rolls back authority, triggers and version with all old bytes on a late migration failure', () => {
  const db = v8(f.path()); const before = durableRows(db);
  try {
    expect(() => transaction(db, () => {
      db.exec(migration009); db.prepare('INSERT INTO journal_authority VALUES(1,?)').run(null);
      db.exec('INSERT INTO missing_late_fault VALUES(1)');
    })).toThrow();
    expect(durableRows(db)).toEqual(before);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(8);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'journal_authority%'").all()).toEqual([]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});

it('exposes no usable identity when fresh initialization cannot commit its migration', async () => {
  const path = f.path(); const seed = new DatabaseSync(path, { enableForeignKeyConstraints: false });
  seed.exec(`CREATE TABLE parent(id PRIMARY KEY); CREATE TABLE child(id REFERENCES parent(id));
    INSERT INTO child VALUES(1);`); seed.close();
  await expect(f.open(path)).rejects.toMatchObject({ code: 'unavailable' });
  const db = new DatabaseSync(path);
  try {
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(0);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('journal_authority','accepted_attempts')").all()).toEqual([]);
    expect(db.prepare('SELECT * FROM child').all()).toEqual([{ id: 1 }]);
  } finally { db.close(); }
});

it('rolls back authority creation when COMMIT itself rejects a deferred foreign key', () => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  db.exec('CREATE TABLE parent(id PRIMARY KEY); CREATE TABLE child(id REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)');
  try {
    expect(() => transaction(db, () => {
      db.exec(migration009); db.prepare('INSERT INTO journal_authority VALUES(1,?)').run(canonical);
      db.exec('INSERT INTO child VALUES(1)');
    })).toThrow();
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(0);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'journal_authority%'").all()).toEqual([]);
    expect(db.prepare('SELECT * FROM child').all()).toEqual([]);
  } finally { db.close(); }
});

it('rejects future version10 through the compiled worker while preserving every row and version', async () => {
  const path = f.path(); const old = v8(path); old.exec('PRAGMA user_version=10');
  const before = durableRows(old); old.close();
  await expect(f.open(path)).rejects.toMatchObject({ code: 'schema_newer' });
  const db = new DatabaseSync(path);
  try {
    expect(durableRows(db)).toEqual(before);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(10);
  } finally { db.close(); }
});
