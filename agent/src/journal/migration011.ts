import type { DatabaseSync } from 'node:sqlite';
import { DISK_HOLD_LIMIT } from '../admission/index.js';
import { admissionSnapshot } from './admission-snapshot.js';
import { metadataColumns, Failure } from './sql.js';
import type { Row } from './sql.js';
import { tables, holdGuards, populate, initializeStats } from './disk-retention/schema.js';
import { parentGuards } from './disk-retention/guards.js';

function originalIdentity(row: Row): boolean {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  return [row.attempt_id, row.organization_id, row.workspace_id].every(value => uuid.test(value))
    && /^[a-f0-9]{64}$/.test(row.intent_digest) && row.generation === 1;
}

/** Conservative upgrade: bounded immutable scheduling metadata, never Offer configs. */
export function migration011(db: DatabaseSync): void {
  const count = db.prepare('SELECT COUNT(*) AS n FROM reservations').get()?.n;
  if (typeof count !== 'number' || count > DISK_HOLD_LIMIT) throw new Failure('unavailable');
  db.exec(tables);
  const rows = db.prepare(`SELECT ${metadataColumns.split(',').map(name => `a.${name.trim()}`).join(',')}
    FROM accepted_attempts a JOIN reservations r USING(attempt_id) ORDER BY r.id LIMIT ${DISK_HOLD_LIMIT}`).all() as unknown as Row[];
  for (const row of rows) {
    if (!originalIdentity(row) || !admissionSnapshot(db, row)) throw new Failure('unavailable');
  }
  if (rows.length !== count) throw new Failure('unavailable');
  db.exec(populate);
  db.exec(initializeStats);
  db.exec(holdGuards);
  db.exec(parentGuards);
  db.exec('PRAGMA user_version=11');
}
