import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { migration025 } from '../../src/adapters/outbound/sqlite/migration025.js';
import { migration031 } from '../../src/adapters/outbound/sqlite/migration031.js';
import { migration032 } from '../../src/adapters/outbound/sqlite/migration032.js';
import { migration033 } from '../../src/adapters/outbound/sqlite/migration033.js';
import { finalProjection } from '../../src/adapters/outbound/sqlite/migration029.js';
import { headerGuards } from '../../src/adapters/outbound/sqlite/output-payloads/guards.js';
import { migration034 } from '../../src/adapters/outbound/sqlite/migration034.js';
import { transaction } from '../../src/adapters/outbound/sqlite/transaction.js';
import { settlementGuards } from '../../src/adapters/outbound/sqlite/backend-settlement/guards.js';

const version = (db: DatabaseSync) => Number(db.prepare('PRAGMA user_version').get()?.user_version);
const graph = (db: DatabaseSync) =>
  db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name').all();
const exists = (db: DatabaseSync, type: string, name: string) =>
  db.prepare('SELECT 1 FROM sqlite_schema WHERE type=? AND name=?').get(type, name) !== undefined;
/** Exact migration003 text, so the restored index matches the shipped predecessor graph. */
const pinLookup = 'CREATE INDEX input_pins_lookup ON revision_input_pins(organization_id,workspace_id,input_id)';
/** Migration 034 narrowed this settlement guard; earlier schemas carry the original text. */
const suitesGuard = /CREATE TRIGGER settlement_suites_update [\s\S]*?END;/.exec(settlementGuards)![0];

/** Removes exactly the migration034 objects. Latest-Run columns and revision Run counts are
 * derived, and migration 034 recomputes them, so nothing retained is lost. */
function dropListing(db: DatabaseSync): void {
  for (const match of migration034.matchAll(/CREATE (TRIGGER|INDEX) ([a-z_]+)/g))
    db.exec(`DROP ${match[1]} ${match[2]}`);
  db.exec(`${suitesGuard}DROP TABLE suite_revision_run_counts;ALTER TABLE suites DROP COLUMN latest_group;
  ALTER TABLE suites DROP COLUMN latest_requested_at;ALTER TABLE suites DROP COLUMN latest_run_id;`);
}

/** Removes exactly the migration033 objects (the table takes its own index and triggers); caller owns the transaction. */
function dropPins(db: DatabaseSync): void {
  db.exec('DROP TRIGGER run_pin_removal_guard;DROP TABLE run_pins;');
}
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
/** Test-only projection of synthetic schema34-39 fixtures to schema33; refuse recorded newer facts. */
export function asSchema33(db: DatabaseSync): void {
  const initial = version(db);
  assert([34, 35, 36, 37, 38, 39].includes(initial), 'Cannot project fixture to schema33');
  if (initial >= 39) assertNoSystemStop(db);
  if (initial >= 36) assert(!db.prepare('SELECT 1 FROM export_jobs WHERE last_agent_report_at IS NOT NULL LIMIT 1').get(),
    'Cannot project recorded agent report time');
  if (initial >= 37) assert(!db.prepare('SELECT 1 FROM run_notes WHERE updated_at IS NOT NULL LIMIT 1').get(),
    'Cannot project recorded note edit time');
  transaction(db, () => {
    if (initial >= 39) restoreOutputFinalization(db);
    if (initial >= 38) restoreRetentionTrigger(db);
    if (initial >= 37) db.exec('ALTER TABLE run_notes DROP COLUMN updated_at');
    if (initial >= 36) db.exec('ALTER TABLE export_jobs DROP COLUMN last_agent_report_at');
    if (initial >= 35) db.exec('DROP INDEX exports_revision_latest');
    dropListing(db);
    db.exec('PRAGMA user_version=33');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  });
}
/**
 * Test-only projection of a synthetic schema31-39 fixture to schema30, peeling 036 (only without report times), 035, 034, 033, 032
 * then 031. Derived 034 listing state is dropped; run pins, authored
 * notes, descriptions, messages and input facts can never be rewound; server-stamped
 * savedAt/savedBy did not exist before 031, so they are dropped with their columns.
 * Every refusal happens before any fixture mutation.
 */
export function asSchema30(db: DatabaseSync): void {
  const initial = version(db);
  if (initial === 30) return;
  assert([31, 32, 33, 34, 35, 36, 37, 38, 39].includes(initial), 'Cannot project fixture to schema30');
  if (initial >= 33) assert(!db.prepare('SELECT 1 FROM run_pins LIMIT 1').get(), 'Cannot project fixture with run pins');
  assert(!db.prepare('SELECT 1 FROM run_notes LIMIT 1').get(), 'Cannot project fixture with run notes');
  assert(!db.prepare('SELECT 1 FROM suites WHERE description IS NOT NULL LIMIT 1').get(), 'Cannot project descriptions');
  assert(!db.prepare('SELECT 1 FROM suite_revisions WHERE message IS NOT NULL LIMIT 1').get(), 'Cannot project messages');
  if (initial >= 32) assertNoInputMetadata(db);
  if (initial >= 39) assertNoSystemStop(db);
  if (initial >= 36) assert(!db.prepare('SELECT 1 FROM export_jobs WHERE last_agent_report_at IS NOT NULL LIMIT 1').get(), 'Cannot project recorded agent report time');
  transaction(db, () => {
    if (initial >= 39) restoreOutputFinalization(db);
    if (initial >= 38) restoreRetentionTrigger(db);
    if (initial >= 36) db.exec('ALTER TABLE export_jobs DROP COLUMN last_agent_report_at');
    if (initial >= 35) db.exec('DROP INDEX exports_revision_latest');
    if (initial >= 34) dropListing(db);
    if (initial >= 33) dropPins(db);
    if (initial >= 32) dropInputMetadata(db);
    dropAuthoring(db);
    db.exec('PRAGMA user_version=30');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  });
}
/**
 * Lets current Store code seed a populated predecessor schema: migration031/032/033 objects
 * exist only while `seed` runs, then the exact predecessor graph and version return.
 * Seeded revisions and inputs lose their stamped metadata exactly as a real predecessor
 * lacked it; seeded shapes and run pins are refused. 032 is added only where its pin
 * tables exist, 033 only where its retention epoch and deletion intent tables exist.
 * Migration 034 objects are never added: Store reads that would need its Run counts
 * use the revision projection modes that skip them.
 */
export function withCurrentWrites<T>(db: DatabaseSync, seed: () => T): T {
  const initial = version(db);
  if (initial >= 33 || exists(db, 'table', 'run_pins')) return seed();
  const authoring = !(initial >= 31 || exists(db, 'table', 'run_notes'));
  const inputs = exists(db, 'index', 'input_pins_lookup');
  const pins = exists(db, 'table', 'retention_workspace_epochs') && exists(db, 'table', 'output_deletion_intents');
  const before = graph(db);
  const ddl = exists(db, 'table', 'run_events') ? migration031 : migration031.replace(/CREATE INDEX run_events_runtime[^;]*;/, '');
  transaction(db, () => {
    if (authoring) db.exec(ddl);
    if (inputs) db.exec(migration032);
    if (pins) db.exec(migration033);
    db.exec(`PRAGMA user_version=${initial};`);
  });
  const result = seed();
  if (authoring) assert(!db.prepare('SELECT 1 FROM run_notes LIMIT 1').get(), 'Predecessor seed cannot hold run notes');
  if (inputs) assert(!db.prepare('SELECT 1 FROM input_shapes LIMIT 1').get(), 'Predecessor seed cannot hold input shapes');
  if (pins) assert(!db.prepare('SELECT 1 FROM run_pins LIMIT 1').get(), 'Predecessor seed cannot hold run pins');
  transaction(db, () => {
    if (pins) dropPins(db);
    if (inputs) dropInputMetadata(db);
    if (authoring) dropAuthoring(db);
    db.exec(`PRAGMA user_version=${initial}`);
  });
  assert.deepEqual(graph(db), before, 'Predecessor schema changed while seeding');
  return result;
}

/** Migration 038 changes only this trigger; restore the exact shipped predecessor. */
function restoreRetentionTrigger(db: DatabaseSync): void {
  const old = /CREATE TRIGGER retention_run_update[\s\S]*?END;/.exec(migration025);
  assert(old, 'Missing shipped retention trigger');
  db.exec('DROP TRIGGER retention_run_update;' + old[0]);
}


function assertNoSystemStop(db: DatabaseSync): void {
  assert(
    !db.prepare("SELECT 1 FROM execution_records WHERE json_type(snapshot_json,'$.systemStopReason') IS NOT NULL LIMIT 1").get(),
    'Cannot project recorded system stop evidence',
  );
}

function restoreOutputFinalization(db: DatabaseSync): void {
  db.exec(`DROP VIEW output_finalization_evidence;${finalProjection}
    DROP TRIGGER output_header_update;${headerGuards.slice(headerGuards.indexOf('CREATE TRIGGER output_header_update'))}`);
}
