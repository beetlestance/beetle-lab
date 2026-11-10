import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { initialize } from '../../src/journal/schema.js';
import { migration008 } from '../../src/journal/migration008.js';
import { migration009 } from '../../src/journal/migration009.js';
import { migration010 } from '../../src/journal/migration010.js';
import { transaction } from '../../src/journal/sql.js';
import { readJournalAuthority } from '../../src/journal/authority.js';
import { journalFixture } from './fixtures.js';
import { removeFutureRetention } from './legacy-fixtures.js';

const f = journalFixture();
function old(path: string, validIdentity = false): DatabaseSync {
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  let literal = readFileSync('agent/test/journal/v7-fixture.sql', 'utf8');
  if (validIdentity) {
    const offer = f.offer();
    literal = literal.replaceAll('Attempt-UPPER', offer.attemptId).replaceAll('Org-UPPER', offer.organizationId)
      .replaceAll('Workspace-UPPER', offer.workspaceId).replaceAll("'intent'", `'${offer.intentDigest}'`);
  }
  db.exec(literal);
  transaction(db, () => { db.exec(migration008); db.exec(migration009); db.exec('INSERT INTO journal_authority VALUES(1,NULL)'); });
  return db;
}
function durable(db: DatabaseSync) {
  return ['accepted_attempts', 'event_spool', 'admission_settings', 'admission_queue', 'reservations',
    'supervision_clock', 'journal_authority', 'sqlite_sequence'].map(table => ({ table, rows: db.prepare(`SELECT * FROM ${table}`).all() }));
}

it('historical10 preserves v9 quarantine and all ownership bytes without backfilling fresh refusal', () => {
  const path = f.path(); const seed = old(path);
  seed.exec('UPDATE admission_settings SET observation_json=NULL'); const before = durable(seed); seed.close();
  const migrated = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  try { transaction(migrated, () => migrated.exec(migration010)); } finally { migrated.close(); }
  for (let count = 0; count < 2; count++) {
    const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    try {
      expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(10);
      expect(durable(db)).toEqual(before);
      expect(db.prepare('SELECT * FROM cancelled_originals').all()).toEqual([]);
      expect(() => readJournalAuthority(db)).toThrow('recovery_required');
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { db.close(); }
  }
  expect(() => initialize(path)).toThrow('unavailable');
  const inspect = new DatabaseSync(path);
  try {
    expect(durable(inspect)).toEqual(before);
    expect(inspect.prepare('SELECT authority FROM journal_authority').get()?.authority).toBeNull();
    expect(inspect.prepare('PRAGMA user_version').get()?.user_version).toBe(10);
    expect(inspect.prepare('SELECT * FROM cancelled_originals').all()).toEqual([]);
  } finally { inspect.close(); }
});

it('preserves fresh v9 UUID and an unknown original when upgrading then cancelling', async () => {
  const path = f.path(); let journal = await f.open(path); const authority = await journal.journalAuthority();
  await journal.immutableOffer(f.offer()); await f.close(journal);
  const seed = new DatabaseSync(path);
  try { removeFutureRetention(seed); seed.exec('DROP TABLE cancelled_originals; PRAGMA user_version=9'); }
  finally { seed.close(); }
  journal = await f.open(path);
  expect(await journal.journalAuthority()).toBe(authority);
  expect(await journal.cancelOriginal({ offer: f.offer(), now: 1000 })).not.toHaveProperty('admission');
  await f.close(journal);
  const db = new DatabaseSync(path);
  try {
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(11);
    expect(db.prepare('SELECT * FROM cancelled_originals').all()).toEqual([]);
  }
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

it('historical10 foreign-key validation rolls back marker schema on v9 corruption', () => {
  const path = f.path(); const seed = old(path);
  seed.exec('PRAGMA foreign_keys=OFF; DELETE FROM accepted_attempts'); seed.close();
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  const before = durable(db);
  try {
    expect(() => transaction(db, () => {
      db.exec(migration010);
      if (db.prepare('PRAGMA foreign_key_check').get()) throw new Error('unavailable');
    })).toThrow('unavailable');
    expect(durable(db)).toEqual(before);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(9);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%cancelled_originals%'").all()).toEqual([]);
  } finally { db.close(); }
});

it('latest initialization rejects missing v9 debt facts and rolls back all schema additions', () => {
  const path = f.path(); const seed = old(path, true); const before = durable(seed);
  expect(seed.prepare('SELECT attempt_id,organization_id,workspace_id,intent_digest FROM accepted_attempts').get()).toEqual({
    attempt_id: f.offer().attemptId, organization_id: f.offer().organizationId,
    workspace_id: f.offer().workspaceId, intent_digest: f.offer().intentDigest });
  expect(seed.prepare('SELECT reservation_json FROM reservations').get()?.reservation_json)
    .toBe('{"charged":133333,"staging":{"policyVersion":1}}');
  const schema = seed.prepare('SELECT * FROM sqlite_master ORDER BY type,name').all(); seed.close();
  expect(() => initialize(path)).toThrow('unavailable');
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  try {
    expect(durable(db)).toEqual(before);
    expect(db.prepare('SELECT * FROM sqlite_master ORDER BY type,name').all()).toEqual(schema);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(9);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(() => readJournalAuthority(db)).toThrow('recovery_required');
  } finally { db.close(); }
});
