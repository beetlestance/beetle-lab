import { DatabaseSync } from 'node:sqlite';
import { StorageError } from './protocol.js';

// Frozen schema19 spelling: change only this CHECK, never derive it from a future enum.
const oldCheck = `reason TEXT CHECK(reason IS NULL OR reason IN ('invalid_config','unsupported_capability','budget_unavailable','setup_failed',
 'engine_crash','memory_limit','timeout','output_limit','cancelled','execution_lost','artifact_incomplete','cursor_expired','conflicting_digest','invalid_protocol'))`;
const newCheck = oldCheck.replace("'timeout','output_limit'", "'timeout','clock_integrity','output_limit'");
const cap = 16_384;
function requireFact(value: unknown): asserts value { if (!value) throw new StorageError('unavailable'); }
function pragma(db: DatabaseSync, name: 'writable_schema' | 'foreign_keys' | 'schema_version'): number {
  const value = db.prepare(`PRAGMA ${name}`).get()?.[name];
  requireFact(typeof value === 'number' && Number.isSafeInteger(value)); return value;
}
/** No-op preparation must be denied even when schema editing is requested. */
function requireProtected(db: DatabaseSync): void {
  requireFact(pragma(db, 'foreign_keys') === 1 && pragma(db, 'writable_schema') === 0);
  let denied = false;
  try {
    db.exec('PRAGMA writable_schema=ON');
    try { db.prepare('UPDATE sqlite_schema SET sql=sql WHERE 0'); }
    catch (error) {
      requireFact(error instanceof Error && /table sqlite_(master|schema) may not be modified/.test(error.message)); denied = true;
    }
  } finally { db.exec('PRAGMA writable_schema=OFF'); }
  requireFact(denied && pragma(db, 'writable_schema') === 0 && pragma(db, 'foreign_keys') === 1);
}
function revisedSql(db: DatabaseSync): { old: string; revised: string } {
  const row = db.prepare(`SELECT CASE WHEN length(CAST(sql AS BLOB))<=${cap} THEN sql END AS sql
    FROM sqlite_schema WHERE type='table' AND name='runs'`).get();
  requireFact(typeof row?.sql === 'string'); const old = row.sql;
  requireFact(old.startsWith('CREATE TABLE runs (') && !old.includes(';'));
  requireFact(old.split(oldCheck).length === 2 && !old.includes("'clock_integrity'"));
  const revised = old.replace(oldCheck, newCheck); requireFact(Buffer.byteLength(revised) <= cap);
  const probe = new DatabaseSync(':memory:', { defensive: true, enableForeignKeyConstraints: true });
  try { probe.exec(revised); } finally { probe.close(); }
  return { old, revised };
}
/** Only a synchronous validated CAS runs with defensive mode temporarily disabled. */
function edit(db: DatabaseSync, sql: { old: string; revised: string }, version: number): void {
  try {
    db.enableDefensive(false); db.exec('PRAGMA writable_schema=ON');
    requireFact(pragma(db, 'writable_schema') === 1);
    const result = db.prepare("UPDATE sqlite_schema SET sql=? WHERE type='table' AND name='runs' AND sql=?").run(sql.revised, sql.old);
    requireFact(result.changes === 1);
    db.exec(`PRAGMA schema_version=${version + 1}`);
  } finally {
    try { db.exec('PRAGMA writable_schema=OFF'); } finally { db.enableDefensive(true); }
  }
}
/** Caller owns the exclusive migration transaction and retires the connection on failure. */
export function migrate020(db: DatabaseSync): void {
  requireFact(db.isTransaction && db.prepare('PRAGMA locking_mode').get()?.locking_mode === 'exclusive'); requireProtected(db);
  const version = pragma(db, 'schema_version'); requireFact(version >= 0 && version < 2_147_483_647);
  const sql = revisedSql(db); edit(db, sql, version);
  requireProtected(db); requireFact(pragma(db, 'schema_version') === version + 1);
  // Reparse with both protections restored, without scanning historical Run payloads.
  db.prepare('SELECT reason FROM runs LIMIT 0').all();
  requireFact(db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='runs'").get()?.sql === sql.revised);
  db.exec('PRAGMA user_version=20');
}
