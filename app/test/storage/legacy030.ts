import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { migration031 } from '../../src/adapters/outbound/sqlite/migration031.js';
import { transaction } from '../../src/adapters/outbound/sqlite/transaction.js';

const version = (db: DatabaseSync) => Number(db.prepare('PRAGMA user_version').get()?.user_version);
const graph = (db: DatabaseSync) =>
  db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name').all();
const exists = (db: DatabaseSync, name: string) =>
  db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name) !== undefined;

/** Removes exactly the migration031 objects; the caller owns the transaction and the version. */
function dropAuthoring(db: DatabaseSync): void {
  db.exec(`DROP TRIGGER run_notes_history_update;DROP TRIGGER run_notes_history_insert;DROP INDEX history_note_owner;
  DROP TABLE history_note_grams;DROP TRIGGER run_notes_retained;DROP TRIGGER run_notes_next;DROP TRIGGER run_notes_first;
  DROP TABLE run_notes;DROP TRIGGER revisions_metadata_insert;DROP INDEX IF EXISTS run_events_runtime;
  ALTER TABLE suite_revisions DROP COLUMN saved_by;ALTER TABLE suite_revisions DROP COLUMN message;
  ALTER TABLE suite_revisions DROP COLUMN saved_at;ALTER TABLE suites DROP COLUMN description;`);
}
/**
 * Test-only projection of a synthetic schema31 fixture to schema30. Authored notes,
 * descriptions and messages can never be rewound; server-stamped savedAt/savedBy did
 * not exist before 031, so they are dropped with their columns.
 */
export function asSchema30(db: DatabaseSync): void {
  const initial = version(db);
  if (initial === 30) return;
  assert(initial === 31, 'Cannot project fixture to schema30');
  assert(!db.prepare('SELECT 1 FROM run_notes LIMIT 1').get(), 'Cannot project fixture with run notes');
  assert(!db.prepare('SELECT 1 FROM suites WHERE description IS NOT NULL LIMIT 1').get(), 'Cannot project descriptions');
  assert(!db.prepare('SELECT 1 FROM suite_revisions WHERE message IS NOT NULL LIMIT 1').get(), 'Cannot project messages');
  transaction(db, () => {
    dropAuthoring(db);
    db.exec('PRAGMA user_version=30');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  });
}
/**
 * Lets current Store code seed a populated predecessor schema: migration031 objects
 * exist only while `seed` runs, then the exact predecessor graph and version return.
 * Seeded revisions lose their stamped metadata exactly as a real predecessor lacked it.
 */
export function withCurrentWrites<T>(db: DatabaseSync, seed: () => T): T {
  const initial = version(db);
  if (initial >= 31 || exists(db, 'run_notes')) return seed();
  const before = graph(db);
  const ddl = exists(db, 'run_events') ? migration031 : migration031.replace(/CREATE INDEX run_events_runtime[^;]*;/, '');
  transaction(db, () => db.exec(`${ddl}PRAGMA user_version=${initial};`));
  const result = seed();
  assert(!db.prepare('SELECT 1 FROM run_notes LIMIT 1').get(), 'Predecessor seed cannot hold run notes');
  transaction(db, () => {
    dropAuthoring(db);
    db.exec(`PRAGMA user_version=${initial}`);
  });
  assert.deepEqual(graph(db), before, 'Predecessor schema changed while seeding');
  return result;
}
