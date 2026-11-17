import { expect, it } from 'vitest';
import { suiteListFixture, time } from './suite-list-fixture.js';
import { scope, uuid } from './fixture.js';

function populated() {
  const f = suiteListFixture();
  f.suite(51, 'Alpha load', 90, 61);
  f.suite(52, 'Beta', 90, 62);
  f.suite(53, 'Gamma', 90);
  f.suite(54, 'Delta', 90, 64);
  f.run(61, 70, 1);
  f.run(62, 71, 2);
  f.run(61, 72, 1);
  return f;
}
/** Direct terminal rows satisfying the runs CHECK; the latest-Run triggers are what is under test. */
function finish(f: ReturnType<typeof suiteListFixture>, id: number, state: string, outcome: string): void {
  const reason = state === 'finished' ? null : state === 'cancelled' ? 'cancelled' : 'execution_lost';
  f.db
    .prepare(`UPDATE runs SET state=?,outcome=?,reason=?,cancellation_requested=?,
      validation_status=CASE WHEN ?='finished' THEN 'passed' ELSE validation_status END WHERE id=?`)
    .run(state, outcome, reason, state === 'cancelled' ? 1 : 0, state, uuid(id));
}
function remove(f: ReturnType<typeof suiteListFixture>, id: number): void {
  f.db.exec('PRAGMA foreign_keys=OFF');
  try {
    f.db.prepare('DELETE FROM runs WHERE id=?').run(uuid(id));
  } finally {
    f.db.exec('PRAGMA foreign_keys=ON');
  }
}

it('orders by latest retained Run with UUID ties, no-run suites last, and inline headers', () => {
  const f = populated();
  try {
    const page = f.list({ folderId: uuid(90) });
    expect(f.ids(page)).toEqual([52, 51, 54, 53]);
    expect(page.nextCursor).toBeNull();
    expect(page.summaries).toEqual([
      { suiteId: uuid(52), engineId: 'k6', group: 'in_progress',
        latestRun: { suiteId: uuid(52), runId: uuid(71), state: 'queued', outcome: 'pending', requestedAt: time(2) } },
      { suiteId: uuid(51), engineId: 'k6', group: 'in_progress',
        latestRun: { suiteId: uuid(51), runId: uuid(72), state: 'queued', outcome: 'pending', requestedAt: time(1) } },
      { suiteId: uuid(54), engineId: 'k6', group: 'no_runs', latestRun: null },
      { suiteId: uuid(53), engineId: null, group: 'no_runs', latestRun: null },
    ]);
    expect(f.ids(f.list({}))).toEqual([52, 51, 54, 53, 50]);
    expect(f.ids(f.list({ folderId: uuid(90), order: 'name' }))).toEqual([51, 52, 54, 53]);
  } finally {
    f.db.close();
  }
});

it('classifies every display group and keeps the engine filter off suites without a revision', () => {
  const f = populated();
  try {
    finish(f, 72, 'finished', 'failed');
    finish(f, 71, 'cancelled', 'inconclusive');
    const group = (value: string) => f.ids(f.list({ folderId: uuid(90), group: value as 'passed' }));
    expect(group('failed')).toEqual([51]);
    expect(group('stopped')).toEqual([52]);
    expect(group('no_runs')).toEqual([54, 53]);
    expect(group('in_progress')).toEqual([]);
    finish(f, 72, 'finished', 'passed');
    expect(group('passed')).toEqual([51]);
    finish(f, 72, 'finished', 'inconclusive');
    expect(group('inconclusive')).toEqual([51]);
    finish(f, 71, 'errored', 'inconclusive');
    expect(group('stopped')).toEqual([52]);
    expect(f.ids(f.list({ folderId: uuid(90), engineId: 'k6' }))).toEqual([52, 51, 54]);
    expect(f.ids(f.list({ folderId: uuid(90), engineId: 'k6', group: 'no_runs' }))).toEqual([54]);
  } finally {
    f.db.close();
  }
});

it('deleting the latest Run reveals the previous retained Run, then No runs', () => {
  const f = populated();
  try {
    expect(f.revision(61).runCount).toBe(2);
    finish(f, 72, 'finished', 'passed');
    remove(f, 72);
    expect(f.list({ folderId: uuid(90) }).summaries![1]).toMatchObject({ suiteId: uuid(51), group: 'in_progress',
      latestRun: { runId: uuid(70) } });
    expect(f.revision(61).runCount).toBe(1);
    finish(f, 70, 'finished', 'failed');
    remove(f, 70);
    expect(f.ids(f.list({ folderId: uuid(90) }))).toEqual([52, 54, 53, 51]);
    expect(f.list({ folderId: uuid(90), group: 'no_runs', engineId: 'k6' }).summaries![1]).toEqual({
      suiteId: uuid(51), engineId: 'k6', group: 'no_runs', latestRun: null });
    expect(f.revision(61).runCount).toBe(0);
    expect(f.store.execute({ kind: 'listRevisions', query: { scope, suiteId: uuid(52), limit: 5 } })).toMatchObject({
      items: [{ id: uuid(62), runCount: 1 }] });
  } finally {
    f.db.close();
  }
});

it('pages with bound cursors in both orders and rejects any binding change', () => {
  const f = populated();
  try {
    for (const order of ['recent_run', 'name'] as const) {
      const seen: number[] = [];
      let cursor: string | undefined;
      do {
        const page = f.list({ limit: 2, order, ...(cursor ? { cursor } : {}) });
        seen.push(...f.ids(page));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(seen).toEqual(f.ids(f.list({ order })));
    }
    const first = f.list({ limit: 1, folderId: uuid(90) });
    for (const change of [{ limit: 2 }, { folderId: uuid(3) }, { group: 'no_runs' }, { engineId: 'k6' },
      { order: 'name' }, { name: 'Alpha' }] as const)
      expect(() => f.list({ limit: 1, folderId: uuid(90), cursor: first.nextCursor!, ...change })).toThrow('invalid_input');
    expect(() => f.list({ folderId: uuid(99) })).toThrow('not found');
  } finally {
    f.db.close();
  }
});

it('searches suite names only, with run-search folding and bounds', () => {
  const f = populated();
  try {
    expect(f.ids(f.list({ name: 'LOAD' }))).toEqual([51]);
    expect(f.ids(f.list({ name: 'folder' }))).toEqual([]);
    expect(f.ids(f.list({ name: 'eta', order: 'name' }))).toEqual([52]);
    expect(f.ids(f.list({ name: 'alpha', folderId: uuid(3) }))).toEqual([]);
    expect(() => f.list({ name: 'ab' })).toThrow('invalid_input');
    const page = f.list({ name: 'synthetic', limit: 1 });
    expect(f.ids(page)).toEqual([50]);
  } finally {
    f.db.close();
  }
});

it('summarizes direct suites per folder in one read with subfolder counts', () => {
  const f = populated();
  try {
    finish(f, 72, 'finished', 'failed');
    const page = f.folders();
    expect(page.items.map((item) => item.id)).toEqual([uuid(90)]);
    expect(page.summaries).toEqual([{ folderId: uuid(90), suiteCount: 4, subfolderCount: 0,
      groups: { in_progress: 1, passed: 0, failed: 1, inconclusive: 0, stopped: 0, no_runs: 2 },
      latestRun: { suiteId: uuid(52), runId: uuid(71), state: 'queued', outcome: 'pending', requestedAt: time(2) } }]);
    expect(f.folders(90).summaries).toEqual([]);
  } finally {
    f.db.close();
  }
});
