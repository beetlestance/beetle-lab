import { reserveAndMark, acknowledge } from './execution-foundation-fixtures.js';
import { transaction } from '../../src/adapters/outbound/sqlite/schema.js';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { initialize, migration001 } from '../../src/adapters/outbound/sqlite/schema.js';
import { migration002 } from '../../src/adapters/outbound/sqlite/migration002.js';
import { migrate003 } from '../../src/adapters/outbound/sqlite/migration003.js';
import { Store } from '../../src/adapters/outbound/sqlite/store.js';
import { command, observation, settingsFixture, uuid, scope, requestId } from './fixture.js';
import { suiteCommand, request } from './suites-fixture.js';
import { runCommand, runOptions } from './runs-fixture.js';

let root = '';
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'beetle-run-migration-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
function seed(db: DatabaseSync): Store {
  const store = new Store(db, { installation: settingsFixture().chain.installation, runtime: observation(), ...runOptions() });
  store.execute({ kind: 'namespace', command: command({ kind: 'createOrganization', id: uuid(1), request: {
    scope: { kind: 'installation' }, requestId: requestId(), name: 'Synthetic', slug: 'synthetic' } }) });
  store.execute({ kind: 'namespace', command: command({ kind: 'createWorkspace', id: uuid(2), rootFolderId: uuid(3), request: {
    scope: { kind: 'organization', organizationId: uuid(1) }, requestId: requestId(), name: 'Synthetic' } }) });
  store.execute({ kind: 'suite', command: suiteCommand({ kind: 'createSuite', id: uuid(50), request: {
    scope, requestId: requestId(), name: 'Synthetic' } }) });
  store.execute({ kind: 'suite', command: suiteCommand({ kind: 'createSuiteRevision', id: uuid(60), suiteId: uuid(50), request: request() }) });
  return store;
}
function prior(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  db.exec(migration001); db.exec(migration002); migrate003(db); return db;
}
it('upgrades3 without changing prior namespace/settings/revision/receipt data and reopens5', () => {
  const path = join(root, 'upgrade.sqlite'); let db = prior(path); seed(db);
  const tables = ['organizations', 'workspaces', 'folders', 'settings', 'suites', 'suite_revisions', 'receipts'];
  const before = tables.map(table => db.prepare(`SELECT * FROM ${table}`).all()); db.close(); db = initialize(path);
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(5);
  expect(tables.map(table => db.prepare(`SELECT * FROM ${table}`).all())).toEqual(before);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]); db.close(); db = initialize(path);
  expect(db.prepare('SELECT count(*) AS n FROM runs').get()?.n).toBe(0); db.close();
});
it('rolls back late migration004 failure and preserves the prior schema/data before successful retry', () => {
  const path = join(root, 'rollback.sqlite'); let db = prior(path); seed(db);
  db.exec("CREATE TABLE dispatch_outbox(canary TEXT); INSERT INTO dispatch_outbox VALUES('synthetic');"); db.close();
  expect(() => initialize(path)).toThrow(); db = new DatabaseSync(path);
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(3);
  expect(db.prepare('SELECT * FROM dispatch_outbox').get()).toEqual({ canary: 'synthetic' });
  for (const name of ['runs', 'attempts', 'runs_page', 'runs_pending']) expect(db.prepare('SELECT name FROM sqlite_master WHERE name=?').get(name)).toBeUndefined();
  expect(db.prepare('SELECT id FROM suite_revisions').get()?.id).toBe(uuid(60));
  db.exec('DROP TABLE dispatch_outbox'); db.close(); db = initialize(path);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]); db.close();
});
it('enforces active-attempt ownership, immutable intent and monotonic possible-delivery evidence', () => {
  const db = initialize(join(root, 'ownership.sqlite')); const store = seed(db);
  store.execute({ kind: 'run', command: runCommand(uuid(60), 70) }); store.execute({ kind: 'run', command: runCommand(uuid(60), 71) });
  expect(() => db.prepare('UPDATE runs SET active_attempt_id=? WHERE id=?').run(uuid(171), uuid(70))).toThrow();
  expect(() => db.prepare("UPDATE runs SET state='cancelled',outcome='inconclusive',cancellation_requested=1,reason=NULL WHERE id=?").run(uuid(70))).toThrow();
  expect(() => db.prepare("UPDATE attempts SET registry_json='{}' WHERE id=?").run(uuid(170))).toThrow();
  const digest = String(db.prepare('SELECT intent_digest FROM attempts WHERE id=?').get(uuid(170))!.intent_digest);
    const key = { runId: uuid(70), attempt: { attemptId: uuid(170), organizationId: uuid(1), workspaceId: uuid(2), intentDigest: digest, generation: 1 as const } };
    transaction(db, () => reserveAndMark(db, key));
  expect(() => db.prepare('UPDATE dispatch_outbox SET possible_delivery=0,first_delivery_at=NULL WHERE attempt_id=?').run(uuid(170))).toThrow();
  expect(() => db.prepare("UPDATE dispatch_outbox SET first_delivery_at='2026-11-10T00:00:00.000Z' WHERE attempt_id=?").run(uuid(170))).toThrow();
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM runs INDEXED BY runs_pending WHERE state IN ('queued','dispatching','active','finalizing') LIMIT 256").all();
  expect(plan.some(row => String(row.detail).includes('runs_pending'))).toBe(true);
  for (const table of ['runs', 'attempts', 'dispatch_outbox']) {
    expect(() => db.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`)).toThrow();
  }
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]); db.close();
});
it('rejects future schema without changing retained data', () => {
  const path = join(root, 'future.sqlite'); let db = new DatabaseSync(path);
  db.exec("PRAGMA user_version=6; CREATE TABLE canary(value TEXT); INSERT INTO canary VALUES('synthetic');"); db.close();
  expect(() => initialize(path)).toThrow(); db = new DatabaseSync(path);
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(6);
  expect(db.prepare('SELECT * FROM canary').get()).toEqual({ value: 'synthetic' }); db.close();
});
it('retains possible-delivery evidence against deletion before an acknowledged generation', () => {
  const db = initialize(join(root, 'delete-fence.sqlite'));
  try {
    const store = seed(db); store.execute({ kind: 'run', command: runCommand(uuid(60), 70) });
    const digest = String(db.prepare('SELECT intent_digest FROM attempts WHERE id=?').get(uuid(170))!.intent_digest);
    const key = { runId: uuid(70), attempt: { attemptId: uuid(170), organizationId: uuid(1), workspaceId: uuid(2), intentDigest: digest, generation: 1 as const } };
    transaction(db, () => reserveAndMark(db, key));
    expect(() => db.prepare('DELETE FROM dispatch_outbox WHERE attempt_id=?').run(uuid(170))).toThrow();
    expect(db.prepare('SELECT possible_delivery,first_delivery_at FROM dispatch_outbox WHERE attempt_id=?').get(uuid(170)))
      .toEqual({ possible_delivery: 1, first_delivery_at: '2026-11-09T00:00:00.000Z' });
    expect(() => db.prepare('DELETE FROM attempts WHERE id=?').run(uuid(170))).toThrow();
    expect(() => db.prepare('DELETE FROM runs WHERE id=?').run(uuid(70))).toThrow();
    // Trusted future ACK transaction witness, not an observed agent response.
    transaction(db, () => acknowledge(db, key));
    expect(() => db.prepare('INSERT INTO dispatch_outbox(attempt_id,intent_digest) SELECT id,intent_digest FROM attempts WHERE id=?').run(uuid(170))).toThrow();
    expect(() => db.prepare('UPDATE attempts SET generation=NULL WHERE id=?').run(uuid(170))).toThrow();
    expect(() => db.prepare('UPDATE attempts SET generation=0 WHERE id=?').run(uuid(170))).toThrow();
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
