import {asSchema20} from '../runtime-association/legacy.js';
import type { DatabaseSync } from 'node:sqlite';
import { removeFutureExport } from './legacy-export.js';
import { transaction } from '../../src/journal/sql.js';

export {JOURNAL_SCHEMA_VERSION as CURRENT_JOURNAL_SCHEMA} from '../../src/journal/schema.js';

/** Remove only additive14 objects, retaining every prior byte and physical fact. */
export function removeFutureAbsence(db: DatabaseSync): void {
  const version = db.prepare('PRAGMA user_version').get()?.user_version;
  if ([26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15].includes(Number(version))) removeFutureExport(db);
  if (db.prepare('PRAGMA user_version').get()?.user_version !== 14
    || db.prepare('SELECT COUNT(*) AS n FROM output_absence_closures').get()?.n !== 0
    || db.prepare('SELECT COUNT(*) AS n FROM accepted_attempts WHERE absence_bytes!=0').get()?.n !== 0) {
    throw new Error('legacy fixture requires empty schema14 closure storage');
  }
  const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name GLOB 'absence_*'").all();
  for (const trigger of triggers) db.exec(`DROP TRIGGER ${String(trigger.name)}`);
  db.exec(`DROP VIEW output_absence_facts; DROP INDEX output_absence_pending; DROP TABLE output_absence_closures;
    ALTER TABLE accepted_attempts DROP COLUMN absence_pending; ALTER TABLE accepted_attempts DROP COLUMN absence_bytes;
    PRAGMA user_version=13;`);
}

const deliveryTriggers = [
  'delivery_parent_insert', 'delivery_insert', 'delivery_inserted', 'delivery_update', 'delivery_delete',
  'delivery_event_insert', 'delivery_event_update', 'disk_parent_update', 'output_source_inserted',
];
const retentionTriggers = [
  'disk_stats_insert', 'disk_stats_delete', 'disk_stats_update',
  'disk_hold_insert', 'disk_hold_inserted', 'disk_hold_delete', 'disk_hold_update', 'disk_hold_updated',
  'disk_parent_insert', 'disk_reservation_insert', 'disk_reservation_inserted',
  'disk_reservation_update', 'disk_reservation_updated', 'disk_reservation_delete',
];
const sourceTriggers = [
  'output_parent_insert', 'output_intent_insert', 'output_intent_delete', 'output_intent_validate',
  'output_intent_inserted', 'output_intent_update', 'output_source_insert', 'output_source_delete',
  'output_source_validate', 'output_source_update',
  'output_reservation_update', 'output_reservation_released', 'output_finished_release',
];
function requireEmptyFuture(db: DatabaseSync): void {
  if (db.prepare('PRAGMA user_version').get()?.user_version !== 20) throw new Error('legacy fixture requires projected schema20');
  const stats = db.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN id=1 AND held_count=0 AND held_output_bytes=0
    AND held_staging_bytes=0 AND retained_output_bytes=0 AND retained_staging_bytes=0 THEN 1 ELSE 0 END) AS valid
    FROM disk_retention_stats`).get();
  if (['disk_holds', 'output_collection_intents', 'output_sources', 'output_delivery_closures'].some(table => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n !== 0)
    || db.prepare(`SELECT COUNT(*) AS n FROM accepted_attempts WHERE typeof(hold_bytes)!='integer' OR hold_bytes!=0
      OR typeof(delivery_bytes)!='integer' OR delivery_bytes!=0 OR typeof(delivery_pending)!='integer' OR delivery_pending!=0
      OR typeof(collection_bytes)!='integer' OR collection_bytes!=0 OR typeof(source_bytes)!='integer' OR source_bytes!=0`).get()?.n !== 0
    || stats?.n !== 1 || stats?.valid !== 1) throw new Error('legacy fixture requires zero source/hold rows and counters');
}

/** Construct an old synthetic schema only after closing its Journal owner. */
export function removeFutureRetention(db: DatabaseSync): void {
  asSchema20(db);
  transaction(db, () => {
    requireEmptyFuture(db);
    removeFutureAbsence(db);
    for (const name of deliveryTriggers) db.exec(`DROP TRIGGER ${name}`);
    db.exec(`DROP INDEX output_delivery_pending; DROP TABLE output_delivery_closures;
      ALTER TABLE accepted_attempts DROP COLUMN delivery_pending; ALTER TABLE accepted_attempts DROP COLUMN delivery_bytes;`);
    for (const name of sourceTriggers) db.exec(`DROP TRIGGER ${name}`);
    db.exec(`DROP TABLE output_sources; DROP TABLE output_collection_intents;
      ALTER TABLE accepted_attempts DROP COLUMN source_bytes; ALTER TABLE accepted_attempts DROP COLUMN collection_bytes;`);
    for (const name of retentionTriggers) db.exec(`DROP TRIGGER ${name}`);
    db.exec('DROP TABLE disk_holds; DROP TABLE disk_retention_stats; ALTER TABLE accepted_attempts DROP COLUMN hold_bytes;');
  });
}
