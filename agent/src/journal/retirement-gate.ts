import type { DatabaseSync } from 'node:sqlite';
import type { Scope } from '../admission/index.js';
import { Failure, owner } from './sql.js';
/** Typed refusal before producer writes; SQL triggers independently enforce the fence. */
export function assertProducerOpen(db: DatabaseSync, key: Scope): void {
  owner(db, key);
  if (db.prepare('SELECT 1 FROM output_retirement_intents WHERE attempt_id=?').get(key.attemptId)) throw new Failure('conflict');
}
