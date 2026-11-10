import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../../src/journal/sql.js';

const retentionTriggers = [
  'disk_stats_insert', 'disk_stats_delete', 'disk_stats_update',
  'disk_hold_insert', 'disk_hold_inserted', 'disk_hold_delete', 'disk_hold_update', 'disk_hold_updated',
  'disk_parent_insert', 'disk_parent_update', 'disk_reservation_insert', 'disk_reservation_inserted',
  'disk_reservation_update', 'disk_reservation_updated', 'disk_reservation_delete',
];

/** Construct an old synthetic schema only after closing its Journal owner. */
export function removeFutureRetention(db: DatabaseSync): void {
  transaction(db, () => {
    if (db.prepare('PRAGMA user_version').get()?.user_version !== 11
      || db.prepare('SELECT COUNT(*) AS n FROM disk_holds').get()?.n !== 0
      || db.prepare('SELECT COUNT(*) AS n FROM accepted_attempts WHERE hold_bytes!=0').get()?.n !== 0) {
      throw new Error('legacy fixture requires current schema with zero disk holds');
    }
    for (const name of retentionTriggers) db.exec(`DROP TRIGGER ${name}`);
    db.exec('DROP TABLE disk_holds; DROP TABLE disk_retention_stats; ALTER TABLE accepted_attempts DROP COLUMN hold_bytes;');
  });
}
