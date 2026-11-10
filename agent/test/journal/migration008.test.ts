import { CURRENT_JOURNAL_SCHEMA } from './legacy-fixtures.js';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { initialize } from '../../src/journal/schema.js';
import { migration008 } from '../../src/journal/migration008.js';
import { transaction } from '../../src/journal/sql.js';
import { journalFixture } from './fixtures.js';

const f = journalFixture();
const tables = ['accepted_attempts', 'event_spool', 'admission_queue', 'reservations', 'supervision_clock'];
const literal = readFileSync('agent/test/journal/v7-fixture.sql', 'utf8');
function legacy(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  db.exec(literal); return db;
}
function migrateHistorical8(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  try { transaction(db, () => db.exec(migration008)); return db; }
  catch (error) { db.close(); throw error; }
}
function contents(db: DatabaseSync) {
  return tables.map(table => ({ table, rows: db.prepare(`SELECT * FROM ${table}`).all(),
    columns: db.prepare(`PRAGMA table_info(${table})`).all(),
    foreignKeys: db.prepare(`PRAGMA foreign_key_list(${table})`).all(),
    indexes: db.prepare(`PRAGMA index_list(${table})`).all().map(index => ({ ...index,
      columns: db.prepare(`PRAGMA index_info(${String(index.name)})`).all() })) }));
}
function sequences(db: DatabaseSync) { return db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all(); }
function definitions(db: DatabaseSync) {
  return tables.map(table => String(db.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(table)?.sql)
    .replaceAll('"', '').replaceAll(/\s/gu, ''));
}

it('preserves literal v7 rows, all four children, defaults/indexes/FKs and three deleted-high identities', () => {
  const path = f.path(); const old = legacy(path); const before = contents(old); const highs = sequences(old);
  const schemas = definitions(old).map((sql, index) => index === 0 ? sql.replaceAll('1048576', '2097152') : sql); old.close();
  const db = migrateHistorical8(path);
  try {
    expect(contents(db)).toEqual(before); expect(sequences(db)).toEqual(highs);
    expect(definitions(db)).toEqual(schemas);
    expect(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(8);
    expect(db.prepare('SELECT * FROM admission_settings').get()).toEqual({
      id: 1, configuration_json: ' {"preserve":true} ', observation_json: '{"obsolete":true}', last_clock: 777 });
    expect(db.prepare(`INSERT INTO accepted_attempts(attempt_id,organization_id,workspace_id,intent_digest,
      generation,state,last_seq,offer_json,canonical_json) VALUES ('next','o','w','d',1,'offered',0,'{}','{}')`).run().lastInsertRowid).toBe(102);
    expect(db.prepare("INSERT INTO admission_queue(attempt_id,candidate_json) VALUES ('next','{}')").run().lastInsertRowid).toBe(203);
    expect(db.prepare("INSERT INTO reservations(attempt_id,reservation_json,charged) VALUES ('next','{}',0)").run().lastInsertRowid).toBe(304);
    for (const table of ['admission_queue', 'reservations', 'supervision_clock']) {
      expect(() => db.exec(`UPDATE ${table} SET attempt_id='orphan'`)).toThrow();
    }
    expect(() => db.exec("UPDATE event_spool SET attempt_id='orphan'")).toThrow();
    expect(() => db.prepare('UPDATE event_spool SET event_json=?').run('x'.repeat(66049))).toThrow();
    expect(() => db.prepare('UPDATE admission_queue SET candidate_json=?').run('x'.repeat(16385))).toThrow();
    expect(() => db.prepare('UPDATE reservations SET reservation_json=?').run('x'.repeat(32769))).toThrow();
    expect(() => db.prepare('UPDATE accepted_attempts SET result_json=?').run('x'.repeat(65537))).toThrow();
    expect(() => db.prepare('UPDATE accepted_attempts SET offer_json=?').run('é'.repeat(1048576) + 'x')).toThrow();
    db.prepare('UPDATE accepted_attempts SET offer_json=?,canonical_json=? WHERE id=17').run('é'.repeat(1048576), 'x'.repeat(2097152));
  } finally { db.close(); }
  const reopened = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  try {
    expect(reopened.prepare('PRAGMA user_version').get()?.user_version).toBe(8);
    expect(reopened.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { reopened.close(); }
});

it.each(['empty-high', 'missing-row'])('preserves %s sequence state and safe subsequent allocation', mode => {
  const path = f.path(); const old = legacy(path);
  old.exec('DELETE FROM event_spool; DELETE FROM admission_queue; DELETE FROM reservations; DELETE FROM supervision_clock; DELETE FROM accepted_attempts;');
  if (mode === 'missing-row') old.exec('DELETE FROM sqlite_sequence');
  const highs = sequences(old); old.close(); const db = migrateHistorical8(path);
  try {
    for (const high of highs) expect(sequences(db)).toContainEqual(high);
    const id = db.prepare(`INSERT INTO accepted_attempts(attempt_id,organization_id,workspace_id,intent_digest,
      generation,state,last_seq,offer_json,canonical_json) VALUES ('new','o','w','d',1,'offered',0,'{}','{}')`).run().lastInsertRowid;
    expect(id).toBe(mode === 'empty-high' ? 102 : 1);
    expect(db.prepare("INSERT INTO admission_queue(attempt_id,candidate_json) VALUES ('new','{}')").run().lastInsertRowid).toBe(mode === 'empty-high' ? 203 : 1);
    expect(db.prepare("INSERT INTO reservations(attempt_id,reservation_json,charged) VALUES ('new','{}',1)").run().lastInsertRowid).toBe(mode === 'empty-high' ? 304 : 1);
  } finally { db.close(); }
});

it('rolls back a late migration fault including rows, indexes, sequences and version, then retries', () => {
  const path = f.path(); const db = legacy(path); const before = contents(db); const highs = sequences(db);
  try {
    const failing = migration008.replace('PRAGMA user_version=8;', 'INSERT INTO missing_fault_table VALUES (1); PRAGMA user_version=8;');
    expect(() => transaction(db, () => db.exec(failing))).toThrow();
    expect(contents(db)).toEqual(before); expect(sequences(db)).toEqual(highs);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(7);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%_v8'").all()).toEqual([]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
  const retried = migrateHistorical8(path);
  try { expect(contents(retried)).toEqual(before); expect(sequences(retried)).toEqual(highs); }
  finally { retried.close(); }
});

it('rejects future schema beyond current without altering its data', () => {
  const path = f.path(); const db = legacy(path); db.exec(`PRAGMA user_version=${CURRENT_JOURNAL_SCHEMA + 1}`); const before = contents(db); db.close();
  expect(() => initialize(path)).toThrow('schema_newer');
  const inspect = new DatabaseSync(path);
  try { expect(contents(inspect)).toEqual(before); expect(inspect.prepare('PRAGMA user_version').get()?.user_version).toBe(CURRENT_JOURNAL_SCHEMA + 1); }
  finally { inspect.close(); }
});
it('rolls back on bounded SQLite disk-full and preserves the v7 graph for retry', () => {
  const path = f.path(); const db = legacy(path); const before = contents(db); const highs = sequences(db);
  try {
    const pages = Number(db.prepare('PRAGMA page_count').get()?.page_count);
    db.exec(`PRAGMA max_page_count=${pages}`);
    expect(() => transaction(db, () => db.exec(migration008))).toThrow();
    expect(contents(db)).toEqual(before); expect(sequences(db)).toEqual(highs);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(7);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%_v8'").all()).toEqual([]);
    db.exec(`PRAGMA max_page_count=${pages + 100}`);
  } finally { db.close(); }
  const retry = migrateHistorical8(path);
  try { expect(contents(retry)).toEqual(before); expect(sequences(retry)).toEqual(highs); }
  finally { retry.close(); }
});

it('latest migration rejects opaque v7 reservation debt atomically without guessing holds', () => {
  const path = f.path(); const old = legacy(path); const before = contents(old); const highs = sequences(old);
  const schema = old.prepare('SELECT * FROM sqlite_master ORDER BY type,name').all();
  const settings = old.prepare('SELECT * FROM admission_settings').all(); old.close();
  expect(() => initialize(path)).toThrow('unavailable');
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  try {
    expect(contents(db)).toEqual(before); expect(sequences(db)).toEqual(highs);
    expect(db.prepare('SELECT * FROM sqlite_master ORDER BY type,name').all()).toEqual(schema);
    expect(db.prepare('SELECT * FROM admission_settings').all()).toEqual(settings);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(7);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
