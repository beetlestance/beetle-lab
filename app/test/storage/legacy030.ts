import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { migration031 } from '../../src/adapters/outbound/sqlite/migration031.js';
import { migration032 } from '../../src/adapters/outbound/sqlite/migration032.js';
import { transaction } from '../../src/adapters/outbound/sqlite/transaction.js';

const version = (db: DatabaseSync) => Number(db.prepare('PRAGMA user_version').get()?.user_version);
const graph = (db: DatabaseSync) =>
  db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name').all();
const exists = (db: DatabaseSync, type: string, name: string) =>
  db.prepare('SELECT 1 FROM sqlite_schema WHERE type=? AND name=?').get(type, name) !== undefined;
/** Exact migration003 text, so the restored index matches the shipped predecessor graph. */
const pinLookup = 'CREATE INDEX input_pins_lookup ON revision_input_pins(organization_id,workspace_id,input_id)';

/** Removes exactly the migration031 objects; the caller owns the transaction and the version. */
function dropAuthoring(db: DatabaseSync): void {
  db.exec(`DROP TRIGGER run_notes_history_update;DROP TRIGGER run_notes_history_insert;DROP INDEX history_note_owner;
  DROP TABLE history_note_grams;DROP TRIGGER run_notes_retained;DROP TRIGGER run_notes_next;DROP TRIGGER run_notes_first;
  DROP TABLE run_notes;DROP TRIGGER revisions_metadata_insert;DROP INDEX IF EXISTS run_events_runtime;
  ALTER TABLE suite_revisions DROP COLUMN saved_by;ALTER TABLE suite_revisions DROP COLUMN message;
  ALTER TABLE suite_revisions DROP COLUMN saved_at;ALTER TABLE suites DROP COLUMN description;`);
}
/** Removes exactly the migration032 objects and restores the 003 pin index; caller owns transaction and version. */
function dropInputMetadata(db: DatabaseSync): void {
  db.exec(`DROP TRIGGER input_usage_count;DROP TRIGGER input_usage_counts_no_delete;DROP TRIGGER input_usage_counts_update;
  DROP TRIGGER input_usage_counts_insert;DROP TABLE input_usage_counts;DROP INDEX input_pins_usage;${pinLookup};
  DROP TRIGGER input_shapes_no_delete;DROP TRIGGER input_shapes_no_update;DROP TRIGGER input_shapes_insert;
  DROP TABLE input_shapes;DROP TRIGGER inputs_times_update;DROP TRIGGER inputs_times_insert;
  ALTER TABLE input_blobs DROP COLUMN published_at;ALTER TABLE input_blobs DROP COLUMN created_at;`);
}
/** Recorded input facts can never be rewound; derived usage counts are dropped with their table. */
function assertNoInputMetadata(db: DatabaseSync): void {
  assert(
    !db.prepare('SELECT 1 FROM input_blobs WHERE created_at IS NOT NULL OR published_at IS NOT NULL LIMIT 1').get(),
    'Cannot project fixture with input times',
  );
  assert(!db.prepare('SELECT 1 FROM input_shapes LIMIT 1').get(), 'Cannot project fixture with input shapes');
}
/**
 * Test-only projection of a synthetic schema31/32 fixture to schema30. Authored notes,
 * descriptions, messages and input facts can never be rewound; server-stamped
 * savedAt/savedBy did not exist before 031, so they are dropped with their columns.
 * Every refusal happens before any fixture mutation.
 */
export function asSchema30(db: DatabaseSync): void {
  const initial = version(db);
  if (initial === 30) return;
  assert(initial === 31 || initial === 32, 'Cannot project fixture to schema30');
  assert(!db.prepare('SELECT 1 FROM run_notes LIMIT 1').get(), 'Cannot project fixture with run notes');
  assert(!db.prepare('SELECT 1 FROM suites WHERE description IS NOT NULL LIMIT 1').get(), 'Cannot project descriptions');
  assert(!db.prepare('SELECT 1 FROM suite_revisions WHERE message IS NOT NULL LIMIT 1').get(), 'Cannot project messages');
  if (initial === 32) assertNoInputMetadata(db);
  transaction(db, () => {
    if (initial === 32) dropInputMetadata(db);
    dropAuthoring(db);
    db.exec('PRAGMA user_version=30');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  });
}
/**
 * Lets current Store code seed a populated predecessor schema: migration031/032 objects
 * exist only while `seed` runs, then the exact predecessor graph and version return.
 * Seeded revisions and inputs lose their stamped metadata exactly as a real predecessor
 * lacked it; seeded shapes are refused. 032 is added only where its pin tables exist.
 */
export function withCurrentWrites<T>(db: DatabaseSync, seed: () => T): T {
  const initial = version(db);
  if (initial >= 32 || exists(db, 'table', 'input_shapes')) return seed();
  const authoring = !(initial >= 31 || exists(db, 'table', 'run_notes'));
  const inputs = exists(db, 'index', 'input_pins_lookup');
  const before = graph(db);
  const ddl = exists(db, 'table', 'run_events') ? migration031 : migration031.replace(/CREATE INDEX run_events_runtime[^;]*;/, '');
  transaction(db, () => {
    if (authoring) db.exec(ddl);
    if (inputs) db.exec(migration032);
    db.exec(`PRAGMA user_version=${initial};`);
  });
  const result = seed();
  if (authoring) assert(!db.prepare('SELECT 1 FROM run_notes LIMIT 1').get(), 'Predecessor seed cannot hold run notes');
  if (inputs) assert(!db.prepare('SELECT 1 FROM input_shapes LIMIT 1').get(), 'Predecessor seed cannot hold input shapes');
  transaction(db, () => {
    if (inputs) dropInputMetadata(db);
    if (authoring) dropAuthoring(db);
    db.exec(`PRAGMA user_version=${initial}`);
  });
  assert.deepEqual(graph(db), before, 'Predecessor schema changed while seeding');
  return result;
}
