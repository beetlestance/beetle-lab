import { afterEach, beforeEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initialize, migration001, transaction } from '../../src/adapters/outbound/sqlite/schema.js';
import { migration002 } from '../../src/adapters/outbound/sqlite/migration002.js';
import { migrate003 } from '../../src/adapters/outbound/sqlite/migration003.js';
import { migration004 } from '../../src/adapters/outbound/sqlite/migration004.js';
import { migration005 } from '../../src/adapters/outbound/sqlite/migration005.js';
import { migration006 } from '../../src/adapters/outbound/sqlite/migration006.js';
import { reserveRunOutput } from '../../src/adapters/outbound/sqlite/output-reservations.js';
import { acknowledge, enqueue, reserveAndMark, seedFoundation } from './execution-foundation-fixtures.js';

let root = '';
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'beetle-event-migration-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const retainedTables = ['runs', 'attempts', 'execution_records', 'execution_intents', 'attempt_output_allocations',
  'installation_storage_usage', 'receipts', 'dispatch_outbox'];
function prior(path: string, bound = true, ack = true): DatabaseSync {
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  db.exec(migration001); db.exec(migration002); migrate003(db); db.exec(migration004); db.exec(migration005);
  if (bound) db.exec(migration006);
  const store = seedFoundation(db); const { key } = enqueue(db, store);
  transaction(db, () => {
    if (bound) reserveAndMark(db, key);
    else {
      db.prepare(`INSERT INTO execution_records(attempt_id,queue_order,run_id,organization_id,workspace_id,intent_digest,
        delivery_attempt_id,output_attempt_id) SELECT attempt_id,queue_order,run_id,organization_id,workspace_id,intent_digest,
        attempt_id,attempt_id FROM execution_intents WHERE attempt_id=?`).run(key.attempt.attemptId);
      reserveRunOutput(db, key, { allocationBytes: Number.MAX_SAFE_INTEGER, reserveBytes: 0 });
      db.exec("UPDATE dispatch_outbox SET possible_delivery=1,first_delivery_at='2026-11-09T00:00:00.000Z'");
    }
    if (ack) acknowledge(db, key);
  });
  if (!bound) db.exec(migration006);
  return db;
}
function retained(db: DatabaseSync): unknown[] {
  return retainedTables.map(table => db.prepare(`SELECT * FROM ${table}`).all());
}

it.each([true, false])('preserves actual schema6 ownership without claiming ingested events, acknowledged=%s', ack => {
  const path = join(root, 'existing.sqlite'); let db = prior(path, true, ack);
  const old = retainedTables.map(table => ({ table, rows: db.prepare(`SELECT * FROM ${table}`).all() })); db.close();
  db = initialize(path);
  try {
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(9);
    for (const { table, rows } of old) {
      const columns = rows[0] ? Object.keys(rows[0]).join(',') : '*';
      expect(db.prepare(`SELECT ${columns} FROM ${table}`).all()).toEqual(rows);
    }
    expect(db.prepare('SELECT event_pending FROM execution_records').get()?.event_pending).toBe(1);
    for (const table of ['event_cursors', 'run_events']) expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});

it('preserves old NULL authority as an indexed unbound diagnostic without event adoption', () => {
  const path = join(root, 'unbound.sqlite'); let db = prior(path, false); db.close(); db = initialize(path);
  try {
    expect(db.prepare(`SELECT journal_authority,event_pending FROM execution_records INDEXED BY execution_event_pending
      WHERE acknowledged_generation=1 AND event_pending=1 LIMIT 33`).all())
      .toEqual([{ journal_authority: null, event_pending: 1 }]);
    expect(db.prepare('SELECT count(*) AS n FROM event_cursors').get()?.n).toBe(0);
    expect(() => db.exec(`INSERT INTO event_cursors(attempt_id,run_id,organization_id,workspace_id,intent_digest,journal_authority,generation)
      SELECT attempt_id,run_id,organization_id,workspace_id,intent_digest,'33333333-3333-4333-8333-333333333333',1 FROM execution_records`)).toThrow();
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});

it('rolls back a late schema007 failure without partial columns, indexes, counters or custody changes', () => {
  const path = join(root, 'rollback.sqlite'); let db = prior(path);
  db.exec("CREATE TABLE run_events(canary TEXT); INSERT INTO run_events VALUES('synthetic');");
  const before = retained(db); db.close();
  expect(() => initialize(path)).toThrow(); db = new DatabaseSync(path);
  try {
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(6);
    expect(db.prepare('PRAGMA table_info(execution_records)').all().some(row => row.name === 'event_pending')).toBe(false);
    for (const name of ['event_cursors', 'execution_event_pending', 'execution_event_binding', 'event_cursor_insert']) {
      expect(db.prepare('SELECT name FROM sqlite_master WHERE name=?').get(name)).toBeUndefined();
    }
    expect(retained(db)).toEqual(before);
    expect(db.prepare('SELECT * FROM run_events').get()).toEqual({ canary: 'synthetic' });
    db.exec('DROP TABLE run_events');
  } finally { db.close(); }
  db = initialize(path);
  try { expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(9); }
  finally { db.close(); }
});

it('reopens the latest schema without resetting retained event obligation or charges', () => {
  const path = join(root, 'reopen.sqlite'); let db = prior(path); db.close(); db = initialize(path);
  const before = retained(db); db.close(); db = initialize(path);
  try { expect(retained(db)).toEqual(before); expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]); }
  finally { db.close(); }
});
