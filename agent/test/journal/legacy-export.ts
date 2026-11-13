import { asSchema15 } from '../staging-namespace/legacy.js';
import type { DatabaseSync } from 'node:sqlite';

/** Synthetic downgrade only: no export authority or result may exist. */
export function removeFutureExport(db: DatabaseSync): void {
  const version = db.prepare('PRAGMA user_version').get()?.user_version;
  if (![15, 16, 17].includes(Number(version))
    || db.prepare('SELECT COUNT(*) AS n FROM export_assignments').get()?.n !== 0
    || db.prepare("SELECT COUNT(*) AS n FROM accepted_attempts WHERE execution_purpose!='performance' OR export_result_json IS NOT NULL").get()?.n !== 0) {
    throw new Error('legacy fixture requires performance-only schema15');
  }
  if ([16, 17].includes(Number(version))) asSchema15(db);
  restorePerformanceSourceGuards(db);
  for (const name of ['execution_purpose_immutable', 'export_assignment_insert', 'export_assignment_immutable',
    'export_assignment_retained', 'result_purpose_exclusive', 'export_result_authority', 'performance_result_authority',
    'export_result_custody_fence', 'export_reservation_authority', 'export_reservation_pinned']) db.exec('DROP TRIGGER ' + name);
  db.exec(`DROP TABLE export_assignments;
    ALTER TABLE accepted_attempts DROP COLUMN execution_purpose;
    ALTER TABLE accepted_attempts DROP COLUMN export_result_json;
    PRAGMA user_version=14;`);
}

function restorePerformanceSourceGuards(db: DatabaseSync): void {
  for (const name of ['output_intent_validate', 'output_source_validate']) {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name);
    if (typeof row?.sql !== 'string' || !row.sql.includes('COALESCE(a.export_result_json,a.result_json)')) throw new Error('missing source guard');
    db.exec('DROP TRIGGER ' + name);
    db.exec(row.sql.replaceAll('COALESCE(a.export_result_json,a.result_json)', 'a.result_json'));
  }
}
