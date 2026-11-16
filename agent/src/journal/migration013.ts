import type { DatabaseSync } from 'node:sqlite';
import { DISK_HOLD_LIMIT } from '../admission/index.js';
import { deliveryTables, deliveryParentGuards, deliveryGuards } from './delivery-schema.js';
import { Failure } from './sql.js';

/** Only mark bounded existing source obligations; never manufacture closure authority. */
export function migration013(db: DatabaseSync): void {
  const sources = db.prepare(`SELECT attempt_id FROM output_sources ORDER BY attempt_id LIMIT ${DISK_HOLD_LIMIT + 1}`).all();
  if (sources.length > DISK_HOLD_LIMIT) throw new Failure('unavailable');
  db.exec(deliveryTables);
  db.exec(deliveryParentGuards);
  db.exec(deliveryGuards);
  db.exec(`UPDATE accepted_attempts SET delivery_pending=1 WHERE attempt_id IN (SELECT attempt_id FROM output_sources);
    PRAGMA user_version=13;`);
}
