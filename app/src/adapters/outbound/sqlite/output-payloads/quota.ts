import type { DatabaseSync } from 'node:sqlite';
import { requirePayload } from './values.js';
/** Maximum total retained C, not incremental headroom; same reservation/counter. */
export function remainingEventAllowance(db: DatabaseSync, attemptId: string, maximum: number): number {
  const row = db.prepare('SELECT body_bytes,artifact_bytes FROM execution_output_charges WHERE attempt_id=?').get(attemptId);
  if (!row) return maximum;
  requirePayload(typeof row.body_bytes === 'number' && Number.isSafeInteger(row.body_bytes) && row.body_bytes >= 0);
  requirePayload(typeof row.artifact_bytes === 'number' && Number.isSafeInteger(row.artifact_bytes) && row.artifact_bytes >= 0);
  requirePayload(row.body_bytes <= maximum && row.artifact_bytes <= maximum - row.body_bytes);
  return maximum - row.body_bytes - row.artifact_bytes;
}
