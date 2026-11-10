import type { DatabaseSync } from 'node:sqlite';
import type { AttemptAdmission } from '@beetle/contracts';
import { Failure } from './sql.js';
import type { Row } from './sql.js';

function requireFact(condition: unknown): asserts condition {
  if (!condition) throw new Failure('unavailable');
}

/** An immutable marker grants refusal only while all non-execution facts agree. */
export function freshRefusal(db: DatabaseSync, row: Row): AttemptAdmission | undefined {
  const marker = db.prepare('SELECT CASE WHEN generation=1 THEN generation END AS generation FROM cancelled_originals WHERE attempt_id=?').get(row.attempt_id);
  if (!marker) return undefined;
  requireFact(marker.generation === 1 && row.generation === 1);
  refusedReceipt(row);
  const facts = db.prepare(`SELECT
    EXISTS(SELECT 1 FROM admission_queue WHERE attempt_id=?) AS queued,
    EXISTS(SELECT 1 FROM reservations WHERE attempt_id=?) AS reserved,
    EXISTS(SELECT 1 FROM event_spool WHERE attempt_id=?) AS events,
    EXISTS(SELECT 1 FROM accepted_attempts WHERE id=? AND (result_json IS NOT NULL
      OR exit_facts_json IS NOT NULL OR wrapper_checkpoint_json IS NOT NULL)) AS native`).get(
    row.attempt_id, row.attempt_id, row.attempt_id, row.id);
  requireFact(facts?.queued === 0 && facts.reserved === 0 && facts.events === 0 && facts.native === 0);
  const clock = db.prepare(`SELECT cancel_reason='cancelled' AS user_cancel,
    typeof(cancel_at)='integer' AND cancel_at BETWEEN 0 AND high_water
      AND typeof(high_water)='integer' AND high_water BETWEEN 0 AND 9007199254740991 AS anchored
    FROM supervision_clock WHERE attempt_id=?`).get(row.attempt_id);
  requireFact(clock?.anchored === 1 && clock.user_cancel === 1);
  return { state: 'rejected', reason: 'cancelled' };
}
function refusedReceipt(row: Row): void {
  requireFact(row.cancel_requested === 1 && row.state === 'offered');
  requireFact([row.phase, row.exit_json, row.result_json, row.exit_facts_json, row.wrapper_checkpoint_json].every(value => value === null));
  requireFact([row.last_seq, row.retained_start_seq, row.acknowledged_seq, row.wrapper_high, row.supervisor_high,
    row.wrapper_expired, row.supervisor_expired, row.spool_bytes, row.spool_rows, row.snapshot_bytes,
    row.checkpoint_bytes].every(value => value === 0));
}
