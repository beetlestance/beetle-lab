import { DatabaseSync } from 'node:sqlite';

/** Native durable oracle, called only after this process closes its Journal owner. */
export function inspectJournal(path: string): unknown {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return { attempts: db.prepare(`SELECT attempt_id,last_seq,acknowledged_seq,retained_start_seq,spool_rows,spool_bytes
      FROM accepted_attempts LIMIT 2`).all(), rows: db.prepare('SELECT seq FROM event_spool ORDER BY seq LIMIT 3').all() };
  } finally { db.close(); }
}
