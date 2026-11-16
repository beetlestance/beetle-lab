import { isHistorical } from './historical.js';
import type { DatabaseSync } from 'node:sqlite';
import { StorageError } from './protocol.js';
export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec(isHistorical(db) ? 'BEGIN' : 'BEGIN IMMEDIATE');
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) {
    try { db.exec('ROLLBACK'); } catch { throw new StorageError('unavailable'); }
    throw error;
  }
}

