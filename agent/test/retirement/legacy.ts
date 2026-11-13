import type { DatabaseSync } from 'node:sqlite';
/** Remove only additive017 objects from synthetic fixtures with no retirement intent. */
export function asSchema16(db: DatabaseSync): void {
  if (db.prepare('PRAGMA user_version').get()?.user_version !== 17
    || db.prepare('SELECT COUNT(*) AS n FROM output_retirement_intents').get()?.n !== 0) throw new Error('Expected empty retirement schema17');
  const triggers = db.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' AND name GLOB 'retirement_*'").all();
  for (const row of triggers) db.exec('DROP TRIGGER ' + String(row.name));
  db.exec('DROP TABLE output_retirement_intents; PRAGMA user_version=16;');
}
