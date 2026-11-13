import type { DatabaseSync } from 'node:sqlite';
import { prior14 } from '../../exports/prior-schema.js';
import { seedFoundation, enqueue } from '../execution-foundation-fixtures.js';
import { transaction } from '../../../src/adapters/outbound/sqlite/schema.js';
import { migration015 } from '../../../src/adapters/outbound/sqlite/migration015.js';
import { migration016 } from '../../../src/adapters/outbound/sqlite/migration016.js';
import { migration017 } from '../../../src/adapters/outbound/sqlite/migration017.js';
import { migration018 } from '../../../src/adapters/outbound/sqlite/migration018.js';
import { migration019 } from '../../../src/adapters/outbound/sqlite/migration019.js';
import { registerAbsenceValidation } from '../../../src/adapters/outbound/sqlite/output-absence/values.js';
import { registerHistoryValidation } from '../../../src/adapters/outbound/sqlite/run-history/values.js';
import { registerSearchFold } from '../../../src/adapters/outbound/sqlite/run-search-fold.js';
/** Real historical migrations and retained run/attempt/outbox rows, no schema rewind. */
export function prior019(path: string) {
  const db = prior14(path);
  registerAbsenceValidation(db); registerHistoryValidation(db); registerSearchFold(db);
  for (const sql of [migration015, migration016, migration017, migration018, migration019]) transaction(db, () => db.exec(sql));
  db.enableDefensive(true); db.exec('PRAGMA locking_mode=EXCLUSIVE;BEGIN EXCLUSIVE;COMMIT'); const value = enqueue(db, seedFoundation(db)); return { db, ...value };
}
export function graph(db: DatabaseSync) {
  return db.prepare('SELECT type,name,tbl_name,rootpage,sql FROM sqlite_schema ORDER BY type,name').all();
}
export function rows(db: DatabaseSync) {
  return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(row => {
    const name = String(row.name); return { name, rows: db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"').all() };
  });
}
