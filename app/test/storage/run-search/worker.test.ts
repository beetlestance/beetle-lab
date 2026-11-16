import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { scope, seed, storageFixture, uuid, createFolder, requestId } from '../fixture.js';
import { append, createSuite, suiteCommand } from '../suites-fixture.js';
import { runCommand, runOptions } from '../runs-fixture.js';
import { asSchema18 } from '../run-history-summary/fixture.js';
import { runListStatement } from '../../../src/adapters/outbound/sqlite/run-list-query.js';
import type { RunListQuery } from '@beetle/contracts/api';
const fixture = storageFixture();
it('searches every historical page by current suite/workspace/folder names, with stable filtered ordering', async () => {
  const metadata = await fixture.open(undefined, runOptions()); await seed(metadata); await seed(metadata, 11, 12, 13);
  const suite = await createSuite(metadata, 50, scope, 'Ｓｅａｒｃｈ 界😀');
  const revision = await append(metadata, suite);
  for (const id of [500, 501, 502, 503, 504]) await metadata.runs.execute(runCommand(revision.id, id));
  const foreign = { ...scope, organizationId: uuid(11), workspaceId: uuid(12) };
  await createSuite(metadata, 51, foreign, 'Search 界😀');
  const query = { scope, limit: 2, name: ' SEARCH ', state: 'queued' as const, outcome: 'pending' as const };
  const first = await metadata.runs.listRuns(query);
  expect(first.items.map(row => row.id)).toEqual([uuid(504), uuid(503)]);
  const second = await metadata.runs.listRuns({ ...query, cursor: first.nextCursor! });
  expect(second.items.map(row => row.id)).toEqual([uuid(502), uuid(501)]);
  expect((await metadata.runs.listRuns({ ...query, cursor: second.nextCursor! })).items.map(row => row.id)).toEqual([uuid(500)]);
  expect((await metadata.runs.listRuns({ ...query, order: 'oldest' })).items.map(row => row.id)).toEqual([uuid(500), uuid(501)]);
  expect((await metadata.runs.listRuns({ scope, limit: 100, name: 'project' })).items).toHaveLength(5);
  expect((await metadata.runs.listRuns({ ...query, name: 'missing' })).items).toEqual([]);
  await expect(metadata.runs.listRuns({ ...query, name: 'missing', cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'invalid_input' });
  const folder = await createFolder(metadata, 30, uuid(3), scope, 'Parent folder');
  const child = await createFolder(metadata, 31, folder.id, scope, 'Child');
  await metadata.suites.execute(suiteCommand({ kind: 'patchSuite', id: suite.id,
    request: { scope, requestId: requestId(), expectedVersion: 2, name: 'Renamed', folderId: child.id } }));
  expect((await metadata.runs.listRuns(query)).items).toEqual([]);
  expect((await metadata.runs.listRuns({ ...query, name: 'parent' })).items).toHaveLength(2);
  expect((await metadata.runs.listRuns({ ...query, name: 'renamed' })).items).toHaveLength(2);
  expect((await metadata.runs.listRuns({ ...query, name: 'parent/child' })).items).toEqual([]);
});
it('resumes bounded backfill after reopen and indexes inserts behind the checkpoint immediately', async () => {
  const path = fixture.path(); let metadata = await fixture.open(path, runOptions()); await seed(metadata);
  for (let n = 50; n < 89; n++) await createSuite(metadata, n, scope, 'Indexed name ' + n);
  await fixture.close(metadata);
  let db = new DatabaseSync(path); asSchema18(db); db.close();
  metadata = await fixture.open(path, runOptions());
  await expect(metadata.runs.listRuns({ scope, limit: 1, name: 'indexed' })).rejects.toMatchObject({ code: 'search_indexing' });
  await fixture.close(metadata); db = new DatabaseSync(path);
  expect(db.prepare('SELECT COUNT(DISTINCT entity_id) AS n FROM history_name_grams').get()?.n).toBe(16);
  expect(db.prepare('SELECT suites_done FROM history_name_progress').get()?.suites_done).toBe(0);
  db.close(); metadata = await fixture.open(path, runOptions());
  const late = await createSuite(metadata, 49, scope, 'Behind checkpoint');
  const revision = await append(metadata, late); await metadata.runs.execute(runCommand(revision.id, 500));
  await expect(metadata.runs.listRuns({ scope, limit: 1, name: 'behind' })).rejects.toMatchObject({ code: 'search_indexing' });
  expect((await metadata.runs.listRuns({ scope, limit: 1, name: 'behind' })).items.map(row => row.id)).toEqual([uuid(500)]);
  await fixture.close(metadata); db = new DatabaseSync(path);
  expect(db.prepare('SELECT folders_done,suites_done FROM history_name_progress').get()).toEqual({ folders_done: 1, suites_done: 1 });
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]); db.close();
});
it('uses covering per-suite time paths for every filter without sorting historical matches', async () => {
  const path = fixture.path(); const metadata = await fixture.open(path, runOptions()); await seed(metadata);
  const revision = await append(metadata, await createSuite(metadata));
  for (let n = 500; n < 520; n++) await metadata.runs.execute(runCommand(revision.id, n));
  expect((await metadata.runs.listRuns({ scope, name: 'suite', limit: 1 })).nextCursor).not.toBeNull();
  await fixture.close(metadata); const db = new DatabaseSync(path);
  for (const filters of [{}, { state: 'queued' }, { outcome: 'pending' }, { state: 'queued', outcome: 'pending' }] as Omit<RunListQuery, 'limit'>[]) {
    const statement = runListStatement({ scope, limit: 1, name: 'suite', ...filters }, uuid(50));
    const plan = db.prepare('EXPLAIN QUERY PLAN ' + statement.sql).all(...statement.values).map(row => row.detail).join('\n');
    expect(plan).toContain('COVERING INDEX runs_history_suite'); expect(plan).not.toContain('TEMP B-TREE'); expect(plan).not.toContain('SCAN ');
  }
  db.close();
});

it('uses one idempotent search fold across trigger/backfill/current verification/cursor without altering name identity', async () => {
  const path = fixture.path(); let metadata = await fixture.open(path, runOptions()); await seed(metadata);
  const suite = await createSuite(metadata, 50, scope, 'J\u030Cxx');
  const revision = await append(metadata, suite);
  for (const id of [500, 501, 502]) await metadata.runs.execute(runCommand(revision.id, id));
  const first = await metadata.runs.listRuns({ scope, limit: 1, name: 'J\u030Cxx' });
  expect(first.items[0]?.id).toBe(uuid(502));
  expect((await metadata.runs.listRuns({ scope, limit: 1, name: 'ǰxx', cursor: first.nextCursor! })).items[0]?.id).toBe(uuid(501));
  await fixture.close(metadata); let db = new DatabaseSync(path);
  expect(db.prepare('SELECT folded_name FROM suites WHERE id=?').get(suite.id)?.folded_name).toBe('j\u030Cxx');
  asSchema18(db); db.close(); metadata = await fixture.open(path, runOptions());
  expect((await metadata.runs.listRuns({ scope, limit: 1, name: 'ǰxx' })).items[0]?.id).toBe(uuid(502));
  await fixture.close(metadata); db = new DatabaseSync(path);
  expect(db.prepare('SELECT folded_name FROM suites WHERE id=?').get(suite.id)?.folded_name).toBe('j\u030Cxx'); db.close();
});
