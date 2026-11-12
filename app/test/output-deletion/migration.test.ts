import { afterEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { migration001, transaction } from '../../src/adapters/outbound/sqlite/schema.js';
import { migration002 } from '../../src/adapters/outbound/sqlite/migration002.js';
import { migrate003 } from '../../src/adapters/outbound/sqlite/migration003.js';
import { migration004 } from '../../src/adapters/outbound/sqlite/migration004.js';
import { migration005 } from '../../src/adapters/outbound/sqlite/migration005.js';
import { migration006 } from '../../src/adapters/outbound/sqlite/migration006.js';
import { migration007 } from '../../src/adapters/outbound/sqlite/migration007.js';
import { migrate008 } from '../../src/adapters/outbound/sqlite/migration008.js';
import { migration009 } from '../../src/adapters/outbound/sqlite/migration009.js';
import { migration010 } from '../../src/adapters/outbound/sqlite/migration010.js';
import { migration011 } from '../../src/adapters/outbound/sqlite/migration011.js';
import { migration012 } from '../../src/adapters/outbound/sqlite/migration012.js';
import { migration013 } from '../../src/adapters/outbound/sqlite/migration013.js';
import { registerAbsenceValidation } from '../../src/adapters/outbound/sqlite/output-absence/values.js';
import { seedFoundation, enqueue, reserveAndMark } from '../storage/execution-foundation-fixtures.js';
const handles: DatabaseSync[] = []; afterEach(() => {for (const db of handles.splice(0)) db.close();});
function previous() {
  const db = new DatabaseSync(':memory:', {enableForeignKeyConstraints: true}); handles.push(db); registerAbsenceValidation(db);
  // Construct the real previous schema from its original steps; never remove new guards.
  for (const step of [migration001, migration002]) db.exec(step); transaction(db, () => migrate003(db));
  for (const step of [migration004,migration005,migration006,migration007]) db.exec(step); transaction(db, () => migrate008(db));
  for (const step of [migration009,migration010,migration011,migration012]) db.exec(step);
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(12);
  const store = seedFoundation(db); const {key} = enqueue(db, store); transaction(db, () => reserveAndMark(db, key, 100000));
  return db;
}
function original(db: DatabaseSync) {
  const tables = ['runs','attempts','execution_intents','dispatch_outbox','execution_records','attempt_output_allocations','installation_storage_usage','receipts'];
  return tables.map(table => ({table, rows: db.prepare(`SELECT * FROM ${table} LIMIT 129`).all()}));
}
it('adds schema13 beside real schema12 with unchanged active ownership, charges, receipts and old guards', () => {
  const db = previous(); const before = original(db);
  const guards = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all();
  transaction(db, () => db.exec(migration013)); expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(13);
  expect(original(db)).toEqual(before);
  for (const guard of guards) expect(db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name=?").get(guard.name!)).toEqual(guard);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
it('rolls back a late migration failure without partial tables, triggers, schema version or changed charges', () => {
  const db = previous(); const before = original(db);
  db.exec('CREATE TABLE output_deletion_files(collision INTEGER)');
  const schema = db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all();
  expect(() => transaction(db, () => db.exec(migration013))).toThrow();
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(12); expect(original(db)).toEqual(before);
  expect(db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all()).toEqual(schema);
});
