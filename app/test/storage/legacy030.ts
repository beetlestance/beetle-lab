import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { initialize } from '../../src/adapters/outbound/sqlite/schema.js';
import { migration031 } from '../../src/adapters/outbound/sqlite/migration031.js';
import { migration034 } from '../../src/adapters/outbound/sqlite/migration034.js';
import { transaction } from '../../src/adapters/outbound/sqlite/transaction.js';
import { settlementGuards } from '../../src/adapters/outbound/sqlite/backend-settlement/guards.js';

const version = (db: DatabaseSync) => Number(db.prepare('PRAGMA user_version').get()?.user_version);
const graph = (db: DatabaseSync) =>
  db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name').all();
const exists = (db: DatabaseSync, name: string) =>
  db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name) !== undefined;
/** Migration 034 narrowed this settlement guard; earlier schemas carry the original text. */
const suitesGuard = /CREATE TRIGGER settlement_suites_update [\s\S]*?END;/.exec(settlementGuards)![0];

/** Removes exactly the migration034 objects; derived latest-Run columns and revision Run counts
 * are recomputed by migration 034, so nothing retained is lost. The caller owns the transaction. */
function dropListing(db: DatabaseSync): void {
  for (const match of migration034.matchAll(/CREATE (TRIGGER|INDEX) ([a-z_]+)/g))
    db.exec(`DROP ${match[1]} ${match[2]}`);
  db.exec(suitesGuard);
  db.exec(`DROP TABLE suite_revision_run_counts;ALTER TABLE suites DROP COLUMN latest_group;
  ALTER TABLE suites DROP COLUMN latest_requested_at;ALTER TABLE suites DROP COLUMN latest_run_id;`);
}
/** Removes exactly the migration031 objects; the caller owns the transaction and the version. */
function dropAuthoring(db: DatabaseSync): void {
  db.exec(`DROP TRIGGER run_notes_history_update;DROP TRIGGER run_notes_history_insert;DROP INDEX history_note_owner;
  DROP TABLE history_note_grams;DROP TRIGGER run_notes_retained;DROP TRIGGER run_notes_next;DROP TRIGGER run_notes_first;
  DROP TABLE run_notes;DROP TRIGGER revisions_metadata_insert;DROP INDEX IF EXISTS run_events_runtime;
  ALTER TABLE suite_revisions DROP COLUMN saved_by;ALTER TABLE suite_revisions DROP COLUMN message;
  ALTER TABLE suite_revisions DROP COLUMN saved_at;ALTER TABLE suites DROP COLUMN description;`);
}
/** Test-only projection of the current shipped schema (34) back to schema31. */
function asSchema31(db: DatabaseSync): void {
  const reference = initialize(':memory:');
  try {
    assert.deepEqual(graph(db), graph(reference), 'Synthetic fixture schema differs from shipped source');
  } finally {
    reference.close();
  }
  transaction(db, () => {
    dropListing(db);
    db.exec('PRAGMA user_version=31');
  });
}
/**
 * Test-only projection of a synthetic current fixture to schema30. Authored notes,
 * descriptions and messages can never be rewound; server-stamped savedAt/savedBy did
 * not exist before 031, so they are dropped with their columns.
 */
export function asSchema30(db: DatabaseSync): void {
  if (version(db) === 30) return;
  if (version(db) === 34) asSchema31(db);
  assert(version(db) === 31, 'Cannot project fixture to schema30');
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
 * Migration 034 objects are not installed: Store reads and writes that would need them
 * use the revision projection modes that skip the Run count.
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
