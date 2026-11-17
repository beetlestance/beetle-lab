import { expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { initialize as prior023 } from '../backend-settlement/prior023.js';
import { migration024 } from '../../src/adapters/outbound/sqlite/migration024.js';
import { migrate025 } from '../../src/adapters/outbound/sqlite/migration025.js';
import { migration026 } from '../../src/adapters/outbound/sqlite/migration026.js';
import { migration027 } from '../../src/adapters/outbound/sqlite/migration027.js';
import { migration028 } from '../../src/adapters/outbound/sqlite/migration028.js';
import { migration029 } from '../../src/adapters/outbound/sqlite/migration029.js';
import { migration030 } from '../../src/adapters/outbound/sqlite/migration030.js';
import { migration032 } from '../../src/adapters/outbound/sqlite/migration032.js';
import { inputUsageSql } from '../../src/adapters/outbound/sqlite/input-usage.js';
import { registerBackendSettlement } from '../../src/adapters/outbound/sqlite/backend-settlement-guard/index.js';
import { registerRetentionAccounting } from '../../src/adapters/outbound/sqlite/retention-accounting-guard/index.js';
import { transaction } from '../../src/adapters/outbound/sqlite/transaction.js';
import { graph, rows } from './clock-reason/fixtures.js';
import { seedFoundation, enqueue } from './execution-foundation-fixtures.js';
import { uuid } from './fixture.js';

const org = uuid(1);
const ws = uuid(2);
const hash = (n: number) => n.toString(16).padStart(64, '0');
/** Writes through the real lifecycle triggers of the predecessor schema. */
function input(db: DatabaseSync, id: string, state: 'staging' | 'published', sha = hash(7)): void {
  db.prepare(
    `INSERT INTO input_blobs(id,organization_id,workspace_id,folder_id,name,sha256,bytes,offset,version,state,create_request_id)
     VALUES(?,?,?,?,?,?,?,0,1,'staging',?)`,
  ).run(id, org, ws, uuid(3), `${id.slice(-2)}.csv`, sha, 12, uuid(900 + Number.parseInt(id.slice(-3), 10)));
  if (state === 'staging') return;
  db.prepare('UPDATE input_blobs SET offset=bytes,version=2 WHERE id=?').run(id);
  db.prepare("UPDATE input_blobs SET state='publishing',version=3,seal_request_id=? WHERE id=?").run(uuid(980), id);
  db.prepare("UPDATE input_blobs SET state='published',version=4 WHERE id=?").run(id);
}
function pin(db: DatabaseSync, revision: string, id: string, sha = hash(7)): void {
  db.prepare('INSERT INTO revision_input_pins VALUES(?,?,?,?,?,?)').run(revision, org, ws, id, sha, 12);
}
function prior030(): DatabaseSync {
  const db = prior023(':memory:');
  registerBackendSettlement(db);
  registerRetentionAccounting(db);
  transaction(db, () => db.exec(migration024));
  transaction(db, () => migrate025(db));
  for (const sql of [migration026, migration027, migration028, migration029, migration030])
    transaction(db, () => db.exec(sql));
  const store = seedFoundation(db);
  enqueue(db, store);
  input(db, uuid(801), 'published');
  input(db, uuid(802), 'staging', hash(8));
  pin(db, uuid(60), uuid(801));
  return db;
}
const addedColumns = new Set(['created_at', 'published_at']);
const addedTables = new Set(['input_shapes', 'input_usage_counts']);
function originalRows(db: DatabaseSync) {
  return rows(db)
    .filter((table) => !addedTables.has(table.name))
    .map((table) =>
      table.name === 'input_blobs'
        ? { ...table, rows: table.rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !addedColumns.has(key)))) }
        : table,
    );
}

it('upgrades populated schema030 with null times, no shapes and exact backfilled usage counts', () => {
  const db = prior030();
  try {
    const before = rows(db);
    transaction(db, () => db.exec(migration032));
    expect(originalRows(db)).toEqual(before);
    expect(db.prepare('SELECT id,created_at,published_at FROM input_blobs ORDER BY id').all()).toEqual([
      { id: uuid(801), created_at: null, published_at: null },
      { id: uuid(802), created_at: null, published_at: null },
    ]);
    expect(db.prepare('SELECT count(*) AS n FROM input_shapes').get()?.n).toBe(0);
    expect(db.prepare('SELECT input_id,revisions FROM input_usage_counts').all()).toEqual([
      { input_id: uuid(801), revisions: 1 },
    ]);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(32);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'input_pins_%'").all()).toEqual([
      { name: 'input_pins_usage' },
    ]);
  } finally {
    db.close();
  }
});

it('rolls a late name collision back to the exact populated schema030', () => {
  const db = prior030();
  try {
    db.exec('CREATE TRIGGER input_usage_count AFTER INSERT ON suites BEGIN SELECT 1; END');
    const before = rows(db);
    const schema = graph(db);
    expect(() => transaction(db, () => db.exec(migration032))).toThrow();
    expect(rows(db)).toEqual(before);
    expect(graph(db)).toEqual(schema);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(30);
  } finally {
    db.close();
  }
});

it('guards times, shapes and maintained usage counts in SQL', () => {
  const db = prior030();
  try {
    transaction(db, () => db.exec(migration032));
    const fail = (sql: string, ...args: (string | number | null)[]) => expect(() => db.prepare(sql).run(...args)).toThrow();
    // Legacy rows stay null: a later publication cannot backfill them, and neither can a direct write.
    fail("UPDATE input_blobs SET created_at='2026-01-01T00:00:00.000Z',version=version+1 WHERE id=?", uuid(801));
    // New rows must carry a creation time and no publication time.
    fail(`INSERT INTO input_blobs(id,organization_id,workspace_id,folder_id,name,sha256,bytes,offset,version,state,create_request_id)
      VALUES(?,?,?,?,'x.csv',?,12,0,1,'staging',?)`, uuid(803), org, ws, uuid(3), hash(9), uuid(990));
    const created = '2026-11-18T10:00:00.000Z';
    db.prepare(`INSERT INTO input_blobs(id,organization_id,workspace_id,folder_id,name,sha256,bytes,offset,version,state,
      create_request_id,created_at) VALUES(?,?,?,?,'x.csv',?,12,0,1,'staging',?,?)`).run(uuid(803), org, ws, uuid(3), hash(9), uuid(990), created);
    fail('UPDATE input_blobs SET offset=12,published_at=?,version=2 WHERE id=?', created, uuid(803));
    db.prepare('UPDATE input_blobs SET offset=12,version=2 WHERE id=?').run(uuid(803));
    db.prepare("UPDATE input_blobs SET state='publishing',version=3,seal_request_id=? WHERE id=?").run(uuid(991), uuid(803));
    fail("UPDATE input_blobs SET state='published',version=4 WHERE id=?", uuid(803));
    db.prepare("UPDATE input_blobs SET state='published',version=4,published_at=? WHERE id=?").run(created, uuid(803));
    fail('UPDATE input_blobs SET created_at=NULL,version=5 WHERE id=?', uuid(803));
    // Shapes: published exact identity only, insert once, never updated or deleted.
    fail('INSERT INTO input_shapes VALUES(?,?,?,?,12,3,2)', org, ws, uuid(802), hash(8));
    fail('INSERT INTO input_shapes VALUES(?,?,?,?,12,3,2)', org, ws, uuid(803), hash(1));
    db.prepare('INSERT INTO input_shapes VALUES(?,?,?,?,12,3,2)').run(org, ws, uuid(803), hash(9));
    fail('INSERT INTO input_shapes VALUES(?,?,?,?,12,4,2)', org, ws, uuid(803), hash(9));
    fail('UPDATE input_shapes SET row_count=4');
    fail('DELETE FROM input_shapes');
    // Counts follow the immutable pins and cannot be written independently.
    pin(db, uuid(60), uuid(803), hash(9));
    expect(db.prepare('SELECT revisions FROM input_usage_counts WHERE input_id=?').get(uuid(803))?.revisions).toBe(1);
    fail('UPDATE input_usage_counts SET revisions=5');
    fail('DELETE FROM input_usage_counts');
    fail('INSERT INTO input_usage_counts VALUES(?,?,?,1)', org, ws, uuid(802));
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    db.close();
  }
});

it('drives the real usage statement from the covering pin index without a sort', () => {
  const db = prior030();
  try {
    transaction(db, () => db.exec(migration032));
    const plan = db
      .prepare(`EXPLAIN QUERY PLAN ${inputUsageSql}`)
      .all(org, ws, uuid(801), '', 11)
      .map((row) => String(row.detail));
    expect(plan[0]).toContain('USING COVERING INDEX input_pins_usage (organization_id=? AND workspace_id=? AND input_id=? AND revision_id>?)');
    expect(plan.some((detail) => /PRIMARY KEY|sqlite_autoindex/.test(detail))).toBe(true);
    expect(plan.join('\n')).not.toMatch(/TEMP B-TREE|SCAN/);
  } finally {
    db.close();
  }
});
