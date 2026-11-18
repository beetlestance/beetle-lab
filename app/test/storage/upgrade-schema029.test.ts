import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initialize as prior023 } from '../backend-settlement/prior023.js';
import { migration024 } from '../../src/adapters/outbound/sqlite/migration024.js';
import { migrate025 } from '../../src/adapters/outbound/sqlite/migration025.js';
import { migration026 } from '../../src/adapters/outbound/sqlite/migration026.js';
import { migration027 } from '../../src/adapters/outbound/sqlite/migration027.js';
import { migration028 } from '../../src/adapters/outbound/sqlite/migration028.js';
import { migration029 } from '../../src/adapters/outbound/sqlite/migration029.js';
import { registerBackendSettlement } from '../../src/adapters/outbound/sqlite/backend-settlement-guard/index.js';
import { registerRetentionAccounting } from '../../src/adapters/outbound/sqlite/retention-accounting-guard/index.js';
import { transaction } from '../../src/adapters/outbound/sqlite/transaction.js';
import { initialize, METADATA_SCHEMA_VERSION } from '../../src/adapters/outbound/sqlite/schema.js';
import {
  inspectColdMetadataForUpgrade,
  METADATA_UPGRADE_SOURCE_VERSION,
} from '../../src/adapters/outbound/sqlite/cold-inspection/index.js';
import { seedFoundation, enqueue } from './execution-foundation-fixtures.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
/** Populated schema029 built from the shipped migration text: the oldest supported upgrade source. */
async function schema029(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'beetle-schema029-'));
  roots.push(root);
  const path = join(root, 'metadata.sqlite');
  const db = prior023(path);
  try {
    registerBackendSettlement(db);
    registerRetentionAccounting(db);
    transaction(db, () => db.exec(migration024));
    transaction(db, () => migrate025(db));
    for (const sql of [migration026, migration027, migration028, migration029]) transaction(db, () => db.exec(sql));
    const store = seedFoundation(db, 4_000_000);
    for (const id of [70, 71, 72, 73]) enqueue(db, store, id);
  } finally {
    db.close();
  }
  return path;
}
const namespace = (db: DatabaseSync) => ({
  organizations: db.prepare('SELECT id,name,slug FROM organizations ORDER BY id').all(),
  workspaces: db.prepare('SELECT id,organization_id,name FROM workspaces ORDER BY id').all(),
  suites: db.prepare('SELECT id,workspace_id,name FROM suites ORDER BY id').all(),
  revisions: db.prepare('SELECT id,suite_id FROM suite_revisions ORDER BY id').all(),
  runs: db.prepare('SELECT id,suite_id,revision_id,state,requested_at FROM runs ORDER BY id').all(),
  settings: db.prepare('SELECT kind,version,value_json FROM settings ORDER BY kind,scope_key').all(),
});
function read<T>(path: string, work: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON');
    return work(db);
  } finally {
    db.close();
  }
}

it('names schema029 upgrade blockers read-only and migrates it to current with every namespace row intact', async () => {
  const path = await schema029();
  expect(METADATA_UPGRADE_SOURCE_VERSION).toBe(29);
  const before = read(path, (db) => {
    expect(db.prepare('PRAGMA user_version').get()!.user_version).toBe(29);
    const id = String(db.prepare("SELECT id FROM settings WHERE scope_key='installation'").get()!.id);
    expect(inspectColdMetadataForUpgrade(db, id)).toMatchObject({ schema: 29, installationId: id });
    expect(inspectColdMetadataForUpgrade(db, id).blockers).toContain('runs');
    return namespace(db);
  });
  expect(before.organizations).toHaveLength(1);
  expect(before.runs).toHaveLength(4);
  initialize(path).close();
  read(path, (db) => {
    expect(db.prepare('PRAGMA user_version').get()!.user_version).toBe(METADATA_SCHEMA_VERSION);
    expect(namespace(db)).toEqual(before);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    const id = String(db.prepare("SELECT id FROM settings WHERE scope_key='installation'").get()!.id);
    expect(inspectColdMetadataForUpgrade(db, id).schema).toBe(METADATA_SCHEMA_VERSION);
  });
});
