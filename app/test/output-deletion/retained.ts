import {expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {encodeCanonicalJson} from '@beetle/contracts';
export function retained(path: string): string {
  const db = new DatabaseSync(path, {readOnly: true});
  try {
    const tables = ['runs','attempts','execution_records','execution_intents','attempt_output_allocations','execution_output_sources',
      'execution_output_payloads','execution_output_slots','execution_output_finalizations','event_cursors','run_events','installation_storage_usage'];
    return encodeCanonicalJson(tables.map(table => {
      const rows = db.prepare(`SELECT * FROM ${table} LIMIT 130`).all(); expect(rows.length).toBeLessThanOrEqual(129);
      return {table, rows: rows.map(row => encodeCanonicalJson(row, 1048576)).sort()};
    }), 2097152);
  } finally {db.close();}
}
