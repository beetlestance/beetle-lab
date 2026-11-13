import type { DatabaseSync } from 'node:sqlite';
/** Synthetic inverse only: make the exact predecessor CHECK before history downgrade. */
export function asSchema19(db: DatabaseSync): void {
  if (db.prepare('PRAGMA user_version').get()?.user_version !== 20
    || db.prepare("SELECT 1 FROM runs WHERE reason='clock_integrity' LIMIT 1").get()) throw new Error('Fixture requires current schema without clock reasons');
  const row = db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='runs'").get();
  if (typeof row?.sql !== 'string' || row.sql.split("'timeout','clock_integrity','output_limit'").length !== 2) throw new Error('Missing current reason CHECK');
  const old = row.sql.replace("'timeout','clock_integrity','output_limit'", "'timeout','output_limit'");
  const version = Number(db.prepare('PRAGMA schema_version').get()?.schema_version);
  try {
    db.enableDefensive(false); db.exec('PRAGMA writable_schema=ON');
    const result = db.prepare("UPDATE sqlite_schema SET sql=? WHERE type='table' AND name='runs' AND sql=?").run(old, row.sql);
    if (result.changes !== 1) throw new Error('Fixture schema changed');
    db.exec(`PRAGMA schema_version=${version + 1}`);
  } finally { try { db.exec('PRAGMA writable_schema=OFF'); } finally { db.enableDefensive(true); } }
  db.prepare('SELECT reason FROM runs LIMIT 0').all(); db.exec('PRAGMA user_version=19');
}
