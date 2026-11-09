import type { DatabaseSync } from 'node:sqlite';

/** Installation-wide fence; both queries stop at the first indexed witness. */
export function hasUntrackedOwnership(db: DatabaseSync): boolean {
  return db.prepare(`SELECT 1 FROM dispatch_outbox INDEXED BY outbox_untracked_ownership
    WHERE execution_intent_id IS NULL AND possible_delivery=1 LIMIT 1`).get() !== undefined ||
    db.prepare(`SELECT 1 FROM attempts INDEXED BY attempts_untracked_ownership
    WHERE execution_intent_id IS NULL AND generation IS NOT NULL LIMIT 1`).get() !== undefined;
}
