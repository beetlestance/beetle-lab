import { expect, it } from 'vitest';
import type { SuitePage } from '@beetle/contracts/api';
import { latestRunHeaderSql } from '../../src/adapters/outbound/sqlite/suite-list/latest-run.js';
import { latestRunPresentation } from '../../src/adapters/outbound/sqlite/suite-list/presentation.js';
import { HistorySummaries } from '../../src/adapters/outbound/sqlite/run-history/index.js';
import { eventFixture, request } from './events/fixtures.js';
import { published, summary } from './run-history-summary/fixture.js';
import { suiteListFixture } from './suite-list-fixture.js';
import { scope, uuid } from './fixture.js';

it.each(['2099-01-01T00:00:00.000Z', '2026-11-10T01:00:00Z', '2026-11-10T02:00:00+01:00'])('projects the current name and durable start with an independent source clock: %s', startedAt => {
  const f = eventFixture();
  const page = () => f.store.execute({ kind: 'listSuites', query: { scope, limit: 100 } }) as SuitePage;
  expect(page().summaries![0]!.latestRun).toMatchObject({ startedAt: null, testDurationMs: null });
  const batch = request(f.binding);
  batch.batch.events[0]!.observedAt = startedAt;
  f.store.execute({ kind: 'eventIngest', request: batch });
  const latest = page().summaries![0]!.latestRun!;
  expect(latest.startedAt).toBe(startedAt);
  expect(latest.startedAt).not.toBe(latest.requestedAt);
  expect(latest.suiteName).toBe(page().items[0]!.name);
  f.db.prepare('UPDATE suites SET name=? WHERE id=?').run('Renamed current suite', latest.suiteId);
  expect(page().summaries![0]!.latestRun!.suiteName).toBe('Renamed current suite');
});
it('uses only a committed identity-bound measured summary and leaves pending duration unknown', () => {
  const f = published();
  const page = () => f.store.execute({ kind: 'listSuites', query: { scope, limit: 100 } }) as SuitePage;
  expect(page().summaries![0]!.latestRun!.testDurationMs).toBeNull();
  const history = new HistorySummaries(f.db);
  const jobs = history.execute({ kind: 'historySummary', operation: { method: 'scan', query: { nowMs: Date.now(), limit: 1 } } });
  if (!Array.isArray(jobs) || !jobs[0]) throw new Error('Missing synthetic history job');
  const job = jobs[0]; const measured = summary(job);
  history.execute({ kind: 'historySummary', operation: { method: 'commit', request: { job, summary: measured } } });
  expect(page().summaries![0]!.latestRun).toMatchObject({ runId: job.id, testDurationMs: 2000 });
  for (const raw of ['{}', '{', JSON.stringify({ ...measured, runId: uuid(99) }), JSON.stringify({ ...measured, attemptId: uuid(99) })]) {
    expect(() => latestRunPresentation(f.db, scope, { id: job.id, active_attempt_id: job.attemptId, history_summary_json: raw }))
      .toThrow(expect.objectContaining({ code: 'unavailable' }));
  }
});
it('keeps the real latest-run name join on scoped primary-key lookups', () => {
  const f = suiteListFixture();
  try {
    const plan = f.db.prepare(`EXPLAIN QUERY PLAN ${latestRunHeaderSql}`).all(scope.organizationId, scope.workspaceId, uuid(70))
      .map(row => String(row.detail)).join('\n');
    expect(plan).toMatch(/SEARCH r USING/);
    expect(plan).toMatch(/SEARCH s USING/);
    expect(plan).not.toMatch(/SCAN [rs]\b/);
    expect(f.db.prepare(latestRunHeaderSql).get(scope.organizationId, uuid(999), uuid(70))).toBeUndefined();
  } finally { f.db.close(); }
});
