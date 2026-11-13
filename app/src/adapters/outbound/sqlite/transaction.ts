import type { DatabaseSync } from 'node:sqlite';
import { StorageError } from './protocol.js';
export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) {
    try { db.exec('ROLLBACK'); } catch { throw new StorageError('unavailable'); }
    throw error;
  }
}

