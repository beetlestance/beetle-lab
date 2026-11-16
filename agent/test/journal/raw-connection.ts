import {DatabaseSync} from 'node:sqlite';
import {prepareColdJournalCopy} from '../../src/journal/schema.js';
/** Current-schema raw SQL tests use the real connection guard registrations.
 * This grants no settlement permit and changes no stored row or charge.
 */
export function rawJournal(path: string, options?: ConstructorParameters<typeof DatabaseSync>[1]): DatabaseSync {
  const db = new DatabaseSync(path, options ?? {});
  try {prepareColdJournalCopy(db); return db;} catch (error) {db.close(); throw error;}
}
