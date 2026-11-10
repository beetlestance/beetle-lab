import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../../src/journal/sql.js';

const retentionTriggers = [
  'disk_stats_insert', 'disk_stats_delete', 'disk_stats_update',
  'disk_hold_insert', 'disk_hold_inserted', 'disk_hold_delete', 'disk_hold_update', 'disk_hold_updated',
  'disk_parent_insert', 'disk_reservation_insert', 'disk_reservation_inserted',
  'disk_reservation_update', 'disk_reservation_updated', 'disk_reservation_delete',
];
const sourceTriggers = [
  'output_parent_insert', 'output_intent_insert', 'output_intent_delete', 'output_intent_validate',
  'output_intent_inserted', 'output_intent_update', 'output_source_insert', 'output_source_delete',
  'output_source_validate', 'output_source_update', 'output_source_inserted',
  'output_reservation_update', 'output_reservation_released', 'output_finished_release',
  'disk_parent_update', // Migration012 replaces this guard with references to its new columns.
];
function requireEmptyFuture(db: DatabaseSync): void {
  if (db.prepare('PRAGMA user_version').get()?.user_version !== 12) throw new Error('legacy fixture requires current schema12');
  const stats = db.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN id=1 AND held_count=0 AND held_output_bytes=0
    AND held_staging_bytes=0 AND retained_output_bytes=0 AND retained_staging_bytes=0 THEN 1 ELSE 0 END) AS valid
    FROM disk_retention_stats`).get();
  if (['disk_holds', 'output_collection_intents', 'output_sources'].some(table => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n !== 0)
    || db.prepare(`SELECT COUNT(*) AS n FROM accepted_attempts WHERE typeof(hold_bytes)!='integer' OR hold_bytes!=0
      OR typeof(collection_bytes)!='integer' OR collection_bytes!=0 OR typeof(source_bytes)!='integer' OR source_bytes!=0`).get()?.n !== 0
    || stats?.n !== 1 || stats?.valid !== 1) throw new Error('legacy fixture requires zero source/hold rows and counters');
}

/** Construct an old synthetic schema only after closing its Journal owner. */
export function removeFutureRetention(db: DatabaseSync): void {
  transaction(db, () => {
    requireEmptyFuture(db);
    for (const name of sourceTriggers) db.exec(`DROP TRIGGER ${name}`);
    db.exec(`DROP TABLE output_sources; DROP TABLE output_collection_intents;
      ALTER TABLE accepted_attempts DROP COLUMN source_bytes; ALTER TABLE accepted_attempts DROP COLUMN collection_bytes;`);
    for (const name of retentionTriggers) db.exec(`DROP TRIGGER ${name}`);
    db.exec('DROP TABLE disk_holds; DROP TABLE disk_retention_stats; ALTER TABLE accepted_attempts DROP COLUMN hold_bytes;');
  });
}
