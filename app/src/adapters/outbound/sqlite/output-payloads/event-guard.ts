import type { DatabaseSync } from 'node:sqlite';
import { requirePayload } from './values.js';
/** Preserve every historical append predicate and replace only its owned payload allowance. */
export function installEventPayloadGuard(db: DatabaseSync): void {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='run_event_insert'").get();
  requirePayload(typeof row?.sql === 'string');
  const old = 'NEW.cumulative_bytes<=min(a.maximum_payload_bytes,67108864)';
  requirePayload(row.sql.split(old).length === 2);
  const remaining = `NEW.cumulative_bytes<=min(a.maximum_payload_bytes
    -coalesce((SELECT body_bytes+artifact_bytes FROM execution_output_charges WHERE attempt_id=NEW.attempt_id),0),67108864)`;
  db.exec('DROP TRIGGER run_event_insert'); db.exec(row.sql.replace(old, remaining));
}
