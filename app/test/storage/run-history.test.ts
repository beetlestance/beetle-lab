import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { encodeRunListCursor } from '@beetle/contracts/api';
import type { RunListQuery } from '@beetle/contracts/api';
import { prepareRunCommand } from '../../src/application/runs/index.js';
import { runListStatement } from '../../src/adapters/outbound/sqlite/run-list-query.js';
import { digest, scope, seed, storageFixture, uuid } from './fixture.js';
import { append, createSuite } from './suites-fixture.js';
import { runCommand, runOptions, runRequest } from './runs-fixture.js';
const fixture = storageFixture();
it('pages actual worker snapshots by time and UUID in both directions, binding every cursor field', async () => {
  const metadata = await fixture.open(undefined, runOptions()); await seed(metadata); await seed(metadata, 11, 12, 13);
  const revision = await append(metadata, await createSuite(metadata));
  for (const [id, requestedAt] of [[500, '2026-11-10T00:00:00.000Z'], [501, '2026-11-09T00:00:00.000Z'], [502, '2026-11-10T00:00:00.000Z']] as const) {
    await metadata.runs.execute(prepareRunCommand({ kind: 'createRun', id: uuid(id), attemptId: uuid(id + 1000), requestedAt, request: runRequest(revision.id) }, digest));
  }
  const first = await metadata.runs.listRuns({ scope, limit: 2 });
  expect(first.items.map(row => row.id)).toEqual([uuid(502), uuid(500)]);
  expect(first.nextCursor).toBe(encodeRunListCursor({ scope, query: { limit: 2, order: 'newest' }, requestedAt: first.items[1]!.requestedAt, id: uuid(500) }));
  const next = await metadata.runs.listRuns({ scope, limit: 2, cursor: first.nextCursor! });
  expect(next.items.map(row => row.id)).toEqual([uuid(501)]); expect(next.nextCursor).toBeNull();
  const oldest = await metadata.runs.listRuns({ scope, limit: 2, order: 'oldest' });
  expect(oldest.items.map(row => row.id)).toEqual([uuid(501), uuid(500)]);
  expect((await metadata.runs.listRuns({ scope, limit: 2, order: 'oldest', cursor: oldest.nextCursor! })).items.map(row => row.id)).toEqual([uuid(502)]);
  for (const extra of [{ limit: 1 }, { order: 'oldest' }, { state: 'queued' }, { outcome: 'pending' },
    { scope: { ...scope, organizationId: uuid(11), workspaceId: uuid(12) } }]) {
    await expect(metadata.runs.listRuns({ scope, limit: 2, cursor: first.nextCursor!, ...extra } as Parameters<typeof metadata.runs.listRuns>[0])).rejects.toMatchObject({ code: 'invalid_input' });
  }
  await expect(metadata.runs.listRuns({ scope, limit: 1, cursor: Buffer.from(JSON.stringify({ after: uuid(500) })).toString('base64url') })).rejects.toMatchObject({ code: 'invalid_input' });
  await expect(metadata.runs.listRuns({ scope: { ...scope, workspaceId: uuid(999) }, limit: 1 })).rejects.toMatchObject({ code: 'not_found' });
  expect((await metadata.runs.listRuns({ scope: { ...scope, organizationId: uuid(11), workspaceId: uuid(12) }, limit: 100 })).items).toEqual([]);
});
it('uses covering indexed paths for every filter and preserves v16 data on migration/reopen', async () => {
  const path = fixture.path(); let metadata = await fixture.open(path, runOptions()); await seed(metadata);
  const revision = await append(metadata, await createSuite(metadata));
  for (let id = 500; id < 511; id++) await metadata.runs.execute(runCommand(revision.id, id));
  const before = await metadata.runs.getRun({ scope, id: uuid(500) }); await fixture.close(metadata);
  const db = new DatabaseSync(path);
  db.exec('DROP INDEX runs_history_outcome; DROP INDEX runs_history_state_outcome; PRAGMA user_version=16;');
  const changes: [number, string, string, string, number, string | null][] = [
    [501, 'dispatching', 'pending', 'pending', 0, null], [502, 'active', 'pending', 'pending', 0, null],
    [503, 'finalizing', 'pending', 'pending', 0, null], [504, 'finished', 'passed', 'passed', 0, null],
    [505, 'finished', 'failed', 'passed', 0, null], [506, 'finished', 'inconclusive', 'passed', 0, null],
    [507, 'cancelled', 'inconclusive', 'pending', 1, 'cancelled'], [508, 'errored', 'inconclusive', 'pending', 0, 'engine_crash'] ];
  for (const [id, state, outcome, validation, cancel, reason] of changes) db.prepare('UPDATE runs SET state=?,outcome=?,validation_status=?,cancellation_requested=?,reason=? WHERE id=?').run(state, outcome, validation, cancel, reason, uuid(id));
  const retained = db.prepare('SELECT COUNT(*) AS n FROM dispatch_outbox').get(); db.close();
  metadata = await fixture.open(path, runOptions()); expect(await metadata.runs.getRun({ scope, id: uuid(500) })).toEqual(before);
  const states = ['queued', 'dispatching', 'active', 'finalizing', 'finished', 'cancelled', 'errored'] as const;
  for (const state of states) {
    const page = await metadata.runs.listRuns({ scope, limit: 100, state });
    expect(page.items.length).toBeGreaterThan(0); expect(page.items.every(row => row.state === state)).toBe(true);
  }
  for (const outcome of ['pending', 'passed', 'failed', 'inconclusive'] as const) {
    const page = await metadata.runs.listRuns({ scope, limit: 100, outcome });
    expect(page.items.length).toBeGreaterThan(0); expect(page.items.every(row => row.outcome === outcome)).toBe(true);
  }
  expect((await metadata.runs.listRuns({ scope, limit: 100, state: 'active', outcome: 'passed' })).items).toEqual([]);
  await fixture.close(metadata); const inspected = new DatabaseSync(path);
  expect(inspected.prepare('PRAGMA user_version').get()?.user_version).toBe(17);
  expect(inspected.prepare('SELECT COUNT(*) AS n FROM dispatch_outbox').get()).toEqual(retained);
  for (const filters of [{}, { state: 'finished' }, { outcome: 'passed' }, { state: 'finished', outcome: 'passed' }] as Omit<RunListQuery, 'limit'>[]) {
    for (const order of ['newest', 'oldest'] as const) {
      const query = { limit: 2, ...filters, order };
      const cursor = encodeRunListCursor({ scope, query, requestedAt: before.requestedAt, id: uuid(510) });
      const statement = runListStatement({ scope, ...query, cursor });
      const plan = inspected.prepare('EXPLAIN QUERY PLAN ' + statement.sql).all(...statement.values).map(row => row.detail).join('\n');
      expect(plan).toContain('COVERING INDEX'); expect(plan).not.toContain('TEMP B-TREE'); expect(plan).not.toContain('SCAN ');
      if ('outcome' in filters) expect(plan).toContain('outcome=?');
      if ('state' in filters) expect(plan).toContain('state=?');
    }
  }
  expect(inspected.prepare('PRAGMA foreign_key_check').all()).toEqual([]); inspected.close();
});
it('reflects lifecycle membership changes between independent pages without moving the keyset', async () => {
  const path = fixture.path(); let metadata = await fixture.open(path, runOptions()); await seed(metadata);
  const revision = await append(metadata, await createSuite(metadata));
  for (const id of [500, 501, 502]) await metadata.runs.execute(runCommand(revision.id, id));
  const first = await metadata.runs.listRuns({ scope, limit: 1, state: 'queued' }); expect(first.items[0]!.id).toBe(uuid(502));
  await fixture.close(metadata); const db = new DatabaseSync(path); db.prepare("UPDATE runs SET state='active' WHERE id=?").run(uuid(501)); db.close();
  metadata = await fixture.open(path, runOptions());
  const next = await metadata.runs.listRuns({ scope, limit: 1, state: 'queued', cursor: first.nextCursor! });
  expect(next.items.map(row => row.id)).toEqual([uuid(500)]); expect(next.nextCursor).toBeNull();
});
