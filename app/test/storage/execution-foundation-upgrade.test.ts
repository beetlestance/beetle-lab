import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { migration001, initialize, transaction } from '../../src/adapters/outbound/sqlite/schema.js';
import { migration002 } from '../../src/adapters/outbound/sqlite/migration002.js';
import { migrate003 } from '../../src/adapters/outbound/sqlite/migration003.js';
import { migration004 } from '../../src/adapters/outbound/sqlite/migration004.js';
import { migration005 } from '../../src/adapters/outbound/sqlite/migration005.js';
import { hasUntrackedOwnership } from '../../src/adapters/outbound/sqlite/execution-ownership.js';
import { seedFoundation, enqueue } from './execution-foundation-fixtures.js';
function legacy(): DatabaseSync {
  const source = initialize(':memory:'); const store = seedFoundation(source); enqueue(source, store);
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  db.exec(migration001); db.exec(migration002); migrate003(db); db.exec(migration004);
  const tables = ['organizations', 'workspaces', 'folders', 'settings', 'suites', 'suite_revisions', 'receipts', 'runs', 'attempts', 'dispatch_outbox'];
  transaction(db, () => {
    for (const table of tables) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name));
      for (const row of source.prepare(`SELECT ${columns.join(',')} FROM ${table}`).all()) {
        db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...columns.map(column => row[column]!));
      }
    }
  }); source.close(); return db;
}
it('upgrades004 byte-for-byte without adopting legacy enqueue and retains indexed terminal uncertainty', () => {
  const db = legacy();
  try {
    db.exec("UPDATE dispatch_outbox SET possible_delivery=1,first_delivery_at='synthetic'; UPDATE runs SET state='errored',outcome='inconclusive',reason='execution_lost';");
    const tables = ['runs', 'attempts', 'dispatch_outbox', 'receipts'];
    const before = tables.map(table => db.prepare(`SELECT * FROM ${table}`).all());
    transaction(db, () => db.exec(migration005));
    tables.forEach((table, i) => {
      const columns = Object.keys(before[i]![0]!);
      expect(db.prepare(`SELECT ${columns.join(',')} FROM ${table}`).all()).toEqual(before[i]);
    });
    expect(db.prepare('SELECT count(*) n FROM execution_intents').get()?.n).toBe(0);
    expect(hasUntrackedOwnership(db)).toBe(true);
    expect(() => db.exec('UPDATE attempts SET execution_intent_id=id')).toThrow();
    expect(() => db.exec('UPDATE dispatch_outbox SET execution_intent_id=attempt_id')).toThrow();
    for (const [table, index, where] of [
      ['attempts', 'attempts_untracked_ownership', 'execution_intent_id IS NULL AND generation IS NOT NULL'],
      ['dispatch_outbox', 'outbox_untracked_ownership', 'execution_intent_id IS NULL AND possible_delivery=1']]) {
      const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT 1 FROM ${table} INDEXED BY ${index} WHERE ${where} LIMIT 1`).all();
      expect(plan.some(row => String(row.detail).includes(String(index)))).toBe(true);
    }
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
it('fences generation-bearing legacy attempts with no outbox regardless of terminal state', () => {
  const db = legacy();
  try {
    db.exec("UPDATE attempts SET generation=1,state='exited'; DELETE FROM dispatch_outbox; UPDATE runs SET state='errored',outcome='inconclusive',reason='execution_lost';");
    transaction(db, () => db.exec(migration005)); expect(hasUntrackedOwnership(db)).toBe(true);
  } finally { db.close(); }
});
it('keeps unpublished legacy unavailable and atomically rolls back late005 failure', () => {
  const db = legacy();
  try {
    db.exec('CREATE TABLE attempt_output_allocations(canary TEXT)');
    expect(() => transaction(db, () => db.exec(migration005))).toThrow();
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(4);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='execution_intents'").get()).toBeUndefined();
    db.exec('DROP TABLE attempt_output_allocations'); transaction(db, () => db.exec(migration005));
    expect(hasUntrackedOwnership(db)).toBe(false);
    expect(() => db.exec("UPDATE dispatch_outbox SET possible_delivery=1,first_delivery_at='synthetic'")).toThrow();
    expect(() => db.exec('UPDATE attempts SET foundation_owned=1')).toThrow();
  } finally { db.close(); }
});
it('keeps indexed ownership checks compact across large known terminal history', () => {
  const db = initialize(':memory:');
  try {
    const store = seedFoundation(db);
    for (let i = 0; i < 500; i++) {
      const { run } = enqueue(db, store, 10000 + i * 2);
      db.prepare("UPDATE runs SET state='errored',outcome='inconclusive',reason='execution_lost' WHERE id=?").run(run.id);
    }
    expect(hasUntrackedOwnership(db)).toBe(false);
    const plan = db.prepare('EXPLAIN QUERY PLAN SELECT 1 FROM attempts INDEXED BY attempts_untracked_ownership WHERE execution_intent_id IS NULL AND generation IS NOT NULL LIMIT 1').all();
    expect(plan.every(row => !String(row.detail).includes('SCAN attempts'))).toBe(true);
  } finally { db.close(); }
});
it.each(['uncertain-outbox', 'acknowledged-outbox', 'acknowledged-no-outbox'])('retains terminal legacy ownership against coupled witness/run erasure (%s)', witness => {
  const db = legacy();
  try {
    db.exec("UPDATE runs SET state='errored',outcome='inconclusive',reason='execution_lost'; UPDATE attempts SET state='exited';");
    if (witness !== 'acknowledged-no-outbox') db.exec("UPDATE dispatch_outbox SET possible_delivery=1,first_delivery_at='synthetic'");
    if (witness !== 'uncertain-outbox') db.exec('UPDATE attempts SET generation=1');
    if (witness === 'acknowledged-no-outbox') db.exec('DELETE FROM dispatch_outbox');
    transaction(db, () => db.exec(migration005));
    const runs = db.prepare('SELECT * FROM runs').all();
    const attempts = db.prepare('SELECT * FROM attempts').all();
    const outbox = db.prepare('SELECT * FROM dispatch_outbox').all();
    expect(hasUntrackedOwnership(db)).toBe(true);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(() => transaction(db, () => {
      db.exec('DELETE FROM dispatch_outbox');
      db.exec('DELETE FROM attempts');
      db.exec('DELETE FROM runs');
    })).toThrow();
    expect(db.prepare('SELECT * FROM runs').all()).toEqual(runs);
    expect(db.prepare('SELECT * FROM attempts').all()).toEqual(attempts);
    expect(db.prepare('SELECT * FROM dispatch_outbox').all()).toEqual(outbox);
    expect(hasUntrackedOwnership(db)).toBe(true);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
