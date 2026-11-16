import type { DatabaseSync } from 'node:sqlite';
import { fail } from './lease-errors.js';

const schema = 'CREATE TABLE lease_state(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL CHECK(version=1)) STRICT';
function value(db: DatabaseSync, name: string): unknown { return db.prepare(`PRAGMA ${name}`).get()?.[name === 'busy_timeout' ? 'timeout' : name]; }
export function configure(db: DatabaseSync, create: boolean): void {
  if (value(db, 'journal_mode') !== 'delete') fail('integrity');
  db.exec('PRAGMA busy_timeout=100; PRAGMA cache_size=-64; PRAGMA mmap_size=0; PRAGMA synchronous=EXTRA; PRAGMA locking_mode=EXCLUSIVE;');
  if (create) db.exec('PRAGMA page_size=4096;');
  db.exec('PRAGMA max_page_count=16; BEGIN EXCLUSIVE;');
  try {
    if (create) db.exec(`${schema}; INSERT INTO lease_state VALUES(1,1); PRAGMA user_version=1;`);
    verify(db); db.exec('COMMIT;');
  } catch (error) { db.exec('ROLLBACK;'); throw error; }
}
function verifySettings(db: DatabaseSync): void {
  const expected = { journal_mode: 'delete', locking_mode: 'exclusive', synchronous: 3, cache_size: -64,
    mmap_size: 0, max_page_count: 16, page_size: 4096, busy_timeout: 100, user_version: 1 };
  for (const [name, required] of Object.entries(expected)) if (value(db, name) !== required) fail('integrity');
  const count = value(db, 'page_count');
  if (typeof count !== 'number' || count < 1 || count > 16) fail('integrity');
}
function verifyState(db: DatabaseSync): void {
  const objects = db.prepare('SELECT name,sql FROM sqlite_schema LIMIT 2').all();
  if (objects.length !== 1 || objects[0]!.name !== 'lease_state' || objects[0]!.sql !== schema) fail('integrity');
  const rows = db.prepare('SELECT id,version FROM lease_state LIMIT 2').all();
  if (rows.length !== 1 || rows[0]!.id !== 1 || rows[0]!.version !== 1) fail('integrity');
}
export function verify(db: DatabaseSync): void {
  verifySettings(db); verifyState(db);
}
