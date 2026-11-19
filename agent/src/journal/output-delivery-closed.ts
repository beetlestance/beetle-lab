import type { DatabaseSync } from 'node:sqlite';

/** Caller has already bound the owning attempt in this journal. */
export function outputDeliveryClosed(db: DatabaseSync, attemptId: string): boolean {
  return db.prepare('SELECT 1 FROM output_delivery_closures WHERE attempt_id=?').get(attemptId) !== undefined;
}
