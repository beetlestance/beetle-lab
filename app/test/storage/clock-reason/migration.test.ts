import { METADATA_SCHEMA_VERSION } from '../../../src/adapters/outbound/sqlite/schema.js';
import { HistorySummaries } from '../../../src/adapters/outbound/sqlite/run-history/index.js';
import { asSchema19 } from './legacy019.js';
import { published, summary } from '../run-history-summary/fixture.js';
import { expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initialize, transaction } from '../../../src/adapters/outbound/sqlite/schema.js';
import { migrate020 } from '../../../src/adapters/outbound/sqlite/migration020.js';
import { storageFixture } from '../fixture.js';
import { graph, prior019, rows } from './fixtures.js';
const f = storageFixture();
function protectedConnection(db: DatabaseSync): void {
  expect(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
  expect(db.prepare('PRAGMA writable_schema').get()?.writable_schema).toBe(0);
  try {
    db.exec('PRAGMA writable_schema=ON');
    expect(() => db.prepare('UPDATE sqlite_schema SET sql=sql WHERE 0')).toThrow('may not be modified');
  } finally { db.exec('PRAGMA writable_schema=OFF'); }
}
it('upgrades real schema19 without touching rows, root pages, indexes, triggers, views or FKs, then reparses on reopen', () => {
  const path = f.path(); const e = prior019(path); const before = rows(e.db); const schema = graph(e.db);
  const version = Number(e.db.prepare('PRAGMA schema_version').get()?.schema_version);
  try {
    transaction(e.db, () => migrate020(e.db)); expect(rows(e.db)).toEqual(before);
    expect(graph(e.db)).toEqual(schema.map(row => row.name === 'runs' ? { ...row,
      sql: String(row.sql).replace("'timeout','output_limit'", "'timeout','clock_integrity','output_limit'") } : row));
    expect(e.db.prepare('PRAGMA schema_version').get()?.schema_version).toBe(version + 1);
    expect(e.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]); protectedConnection(e.db);
  } finally { e.db.close(); }
  const reopened = initialize(path);
  try {
    expect(reopened.prepare('PRAGMA user_version').get()?.user_version).toBe(METADATA_SCHEMA_VERSION); expect(rows(reopened).filter(row=>row.name!=='backend_cleanup_controls')).toEqual(before); expect(reopened.prepare('SELECT count(*) n FROM backend_cleanup_controls').get()?.n).toBe(0);
    protectedConnection(reopened); reopened.prepare("UPDATE runs SET reason='clock_integrity'").run();
    expect(reopened.prepare('SELECT reason FROM runs').get()?.reason).toBe('clock_integrity');
    expect(() => reopened.exec("UPDATE runs SET reason='invented_reason'")).toThrow();
    expect(reopened.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');
  } finally { reopened.close(); }
});
it('rolls a late deferred COMMIT failure back to exact schema19 and rows with protections restored', () => {
  const path = f.path(); const { db } = prior019(path);
  db.exec('CREATE TABLE fault_parent(id PRIMARY KEY);CREATE TABLE fault_child(id REFERENCES fault_parent(id) DEFERRABLE INITIALLY DEFERRED)');
  const before = rows(db); const schema = graph(db); const version = db.prepare('PRAGMA schema_version').get();
  try {
    expect(() => transaction(db, () => { migrate020(db); db.exec('INSERT INTO fault_child VALUES(1)'); })).toThrow();
    expect(rows(db)).toEqual(before); expect(graph(db)).toEqual(schema); expect(db.prepare('PRAGMA schema_version').get()).toEqual(version);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(19); protectedConnection(db);
  } finally { db.close(); }
  const reopened = new DatabaseSync(path, { defensive: true });
  try { expect(graph(reopened)).toEqual(schema); expect(rows(reopened)).toEqual(before); protectedConnection(reopened); }
  finally { reopened.close(); }
  const retried = initialize(path); try { expect(retried.prepare('PRAGMA user_version').get()?.user_version).toBe(METADATA_SCHEMA_VERSION); expect(rows(retried).filter(row=>row.name!=='backend_cleanup_controls')).toEqual(before); expect(retried.prepare('SELECT count(*) n FROM backend_cleanup_controls').get()?.n).toBe(0); }
  finally { retried.close(); }
});
it('rejects unexpected CHECK spelling before entering the privileged edit window', () => {
  const { db } = prior019(f.path()); db.exec('ALTER TABLE runs RENAME COLUMN reason TO diagnostic_reason');
  const schema = graph(db); const before = rows(db); const privilege = vi.spyOn(db, 'enableDefensive');
  try {
    expect(() => transaction(db, () => migrate020(db))).toThrow(); expect(privilege).not.toHaveBeenCalled();
    expect(graph(db)).toEqual(schema); expect(rows(db)).toEqual(before); protectedConnection(db);
  } finally { privilege.mockRestore(); db.close(); }
});
it('restores protection and rolls back the metadata CAS when final reparsing fails', () => {
  const { db } = prior019(f.path()); const schema = graph(db); const before = rows(db); const prepare = db.prepare.bind(db);
  const fault = vi.spyOn(db, 'prepare').mockImplementation(sql => {
    if (sql === 'SELECT reason FROM runs LIMIT 0') throw new Error('Synthetic post-CAS parse failure'); return prepare(sql);
  });
  try {
    expect(() => transaction(db, () => migrate020(db))).toThrow('Synthetic post-CAS parse failure'); fault.mockRestore();
    expect(graph(db)).toEqual(schema); expect(rows(db)).toEqual(before); protectedConnection(db);
  } finally { fault.mockRestore(); db.close(); }
});

it('preserves committed history projection, publication payloads and every charge in a populated predecessor', () => {
  const e = published(); const history = new HistorySummaries(e.db);
  const jobs = history.execute({ kind: 'historySummary', operation: { method: 'scan', query: { nowMs: 1000, limit: 1 } } });
  if (!Array.isArray(jobs) || !jobs[0]) throw new Error('Missing actual history job');
  history.execute({ kind: 'historySummary', operation: { method: 'commit', request: { job: jobs[0], summary: summary(jobs[0]) } } });
  expect(e.db.prepare('SELECT history_summary_json FROM runs').get()?.history_summary_json).toBeTruthy();
  asSchema19(e.db); const before = rows(e.db); const schema = graph(e.db); const charge = e.usage();
  transaction(e.db, () => migrate020(e.db)); expect(rows(e.db)).toEqual(before); expect(e.usage()).toBe(charge);
  expect(graph(e.db)).toEqual(schema.map(row => row.name === 'runs' ? { ...row,
    sql: String(row.sql).replace("'timeout','output_limit'", "'timeout','clock_integrity','output_limit'") } : row));
  expect(e.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]); protectedConnection(e.db);
});
it.each(['no-transaction', 'foreign-keys-off'] as const)('refuses %s before granting schema edit capability', mode => {
  const { db } = prior019(f.path()); const schema = graph(db); const privilege = vi.spyOn(db, 'enableDefensive');
  try {
    if (mode === 'no-transaction') expect(() => migrate020(db)).toThrow();
    else { db.exec('PRAGMA foreign_keys=OFF'); expect(() => transaction(db, () => migrate020(db))).toThrow(); db.exec('PRAGMA foreign_keys=ON'); }
    expect(privilege).not.toHaveBeenCalled(); expect(graph(db)).toEqual(schema); protectedConnection(db);
  } finally { privilege.mockRestore(); db.exec('PRAGMA foreign_keys=ON'); db.close(); }
});
it('bounds predecessor SQL before editing or cloning it', () => {
  const { db } = prior019(f.path()); db.exec('ALTER TABLE runs ADD COLUMN p' + 'a'.repeat(16_384) + ' TEXT');
  const schema = graph(db); const privilege = vi.spyOn(db, 'enableDefensive');
  try {
    expect(() => transaction(db, () => migrate020(db))).toThrow(); expect(privilege).not.toHaveBeenCalled();
    expect(graph(db)).toEqual(schema); protectedConnection(db);
  } finally { privilege.mockRestore(); db.close(); }
});
it('retires the startup connection if protection restoration rejects after the CAS', () => {
  const path = f.path(); const { db } = prior019(path); const schema = graph(db); const location = db.location(); db.close();
  const original = DatabaseSync.prototype.enableDefensive; let entered = false;
  const fault = vi.spyOn(DatabaseSync.prototype, 'enableDefensive').mockImplementation(function(this: DatabaseSync, active) {
    original.call(this, active); if (!active) entered = true;
    if (active && entered && this.location() === location) throw new Error('Synthetic restoration failure');
  });
  try { expect(() => initialize(path)).toThrow('Synthetic restoration failure'); expect(entered).toBe(true); }
  finally { fault.mockRestore(); }
  const reopened = new DatabaseSync(path, { defensive: true });
  try {
    expect(reopened.prepare('PRAGMA user_version').get()?.user_version).toBe(19); expect(graph(reopened)).toEqual(schema);
    protectedConnection(reopened);
  } finally { reopened.close(); }
});
