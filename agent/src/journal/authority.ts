import type { DatabaseSync } from 'node:sqlite';
import { Failure } from './sql.js';

export function isJournalAuthority(value: unknown): value is string {
  return typeof value === 'string' && value.length === 36
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
}

/** Read at most two rows and 36 bytes per identity; never adopt or repair. */
export function readJournalAuthority(db: DatabaseSync): string {
  try {
    const rows = db.prepare(`SELECT CASE WHEN typeof(id)='integer' AND id=1 THEN 1 ELSE NULL END AS id,
      CASE WHEN typeof(authority)='text'
      AND length(CAST(authority AS BLOB))=36 THEN authority ELSE NULL END AS authority
      FROM journal_authority LIMIT 2`).all();
    const row = rows[0];
    if (rows.length !== 1 || row?.id !== 1 || !isJournalAuthority(row.authority)) {
      throw new Failure('recovery_required');
    }
    return row.authority;
  } catch { throw new Failure('recovery_required'); }
}
