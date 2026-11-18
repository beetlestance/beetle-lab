import { expect, it } from 'vitest';
import {
  captureSuiteListCursor,
  encodeSuiteListCursor,
  folderPageSummariesMatch,
  normalizeSuiteListQuery,
  suiteGroupOf,
  suiteListPageMatches,
  suiteListPosition,
} from '../../src/api/index.js';
import type { FolderPage, Suite, SuiteListSummary, SuitePage } from '../../src/api/index.js';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { kind: 'workspace' as const, organizationId: uuid(1), workspaceId: uuid(2) };
const at = (minute: number) => `2026-11-09T00:${String(minute).padStart(2, '0')}:00.000Z`;
const suite = (n: number, revision = true): Suite => ({
  id: uuid(n), scope, version: 1, name: `Suite ${n}`, folderId: uuid(3), currentRevisionId: revision ? uuid(n + 100) : null });
const summary = (n: number, minute: number | null, revision = true): SuiteListSummary => ({
  suiteId: uuid(n), engineId: revision ? 'k6' : null, group: minute === null ? 'no_runs' : 'failed',
  latestRun: minute === null ? null : { suiteName: `Suite ${n}`, startedAt: null, testDurationMs: null, suiteId: uuid(n), runId: uuid(n + 200), state: 'finished', outcome: 'failed', requestedAt: at(minute) } });

it('derives one display group from state and outcome', () => {
  expect(suiteGroupOf(null)).toBe('no_runs');
  for (const state of ['queued', 'dispatching', 'active', 'finalizing'] as const)
    expect(suiteGroupOf({ state, outcome: 'pending' })).toBe('in_progress');
  for (const outcome of ['passed', 'failed', 'inconclusive'] as const) expect(suiteGroupOf({ state: 'finished', outcome })).toBe(outcome);
  expect(suiteGroupOf({ state: 'cancelled', outcome: 'inconclusive' })).toBe('stopped');
  expect(suiteGroupOf({ state: 'errored', outcome: 'inconclusive' })).toBe('stopped');
});
it('round-trips canonical cursors and rejects every binding change', () => {
  const query = normalizeSuiteListQuery({ limit: 2, folderId: uuid(3).toUpperCase(), group: 'failed', engineId: 'k6', name: ' Check ' });
  expect(query).toMatchObject({ order: 'recent_run', folderId: uuid(3) });
  const cursor = encodeSuiteListCursor({ scope, query, requestedAt: at(1), id: uuid(5) });
  expect(captureSuiteListCursor(cursor)).toEqual({ scope, query, requestedAt: at(1), id: uuid(5) });
  expect(suiteListPosition(scope, { ...query, cursor })?.id).toBe(uuid(5));
  for (const change of [{ limit: 3 }, { folderId: uuid(4) }, { group: 'passed' }, { order: 'name' }, { name: 'Other' }] as const)
    expect(() => suiteListPosition(scope, { ...query, ...change, cursor })).toThrow();
  expect(() => suiteListPosition({ ...scope, workspaceId: uuid(9) }, { ...query, cursor })).toThrow();
  expect(() => encodeSuiteListCursor({ scope, query: { ...query, order: 'name' }, requestedAt: at(1), id: uuid(5) })).toThrow();
  expect(() => suiteListPosition(scope, { limit: 2, cursor: 'opaque_page_2' })).toThrow();
});
it('checks row facts, recent_run order and exact continuation of a page', () => {
  const page: SuitePage = { scope, items: [suite(6), suite(5)], summaries: [summary(6, 2), summary(5, 1)], nextCursor: null };
  expect(suiteListPageMatches(page, scope, { limit: 2 })).toBe(true);
  expect(suiteListPageMatches({ ...page, items: [suite(5), suite(6)], summaries: [summary(5, 1), summary(6, 2)] }, scope, { limit: 2 })).toBe(false);
  expect(suiteListPageMatches({ ...page, summaries: [summary(6, 2), { ...summary(5, 1), group: 'passed' }] }, scope, { limit: 2 })).toBe(false);
  expect(suiteListPageMatches({ ...page, summaries: [summary(6, 2), summary(5, 1, false)] }, scope, { limit: 2 })).toBe(false);
  expect(suiteListPageMatches(page, scope, { limit: 2, group: 'passed' })).toBe(false);
  const query = normalizeSuiteListQuery({ limit: 2 });
  const nextCursor = encodeSuiteListCursor({ scope, query, requestedAt: at(1), id: uuid(5) });
  expect(suiteListPageMatches({ ...page, nextCursor }, scope, { limit: 2 })).toBe(true);
  expect(suiteListPageMatches({ ...page, nextCursor: 'opaque' }, scope, { limit: 2 })).toBe(false);
  const noRuns: SuitePage = { scope, items: [suite(6, false), suite(5)], summaries: [summary(6, null, false), summary(5, null)], nextCursor: null };
  expect(suiteListPageMatches(noRuns, scope, { limit: 2 })).toBe(true);
});
it('checks folder summaries classify each direct suite once', () => {
  const folder = { id: uuid(4), version: 1, scope, name: 'Folder', parentFolderId: uuid(3), displayPath: ['Folder'] };
  const groups = { in_progress: 0, passed: 0, failed: 1, inconclusive: 0, stopped: 0, no_runs: 1 };
  const latestRun = summary(5, 1).latestRun;
  const page: FolderPage = { scope, items: [folder], nextCursor: null,
    summaries: [{ folderId: uuid(4), suiteCount: 2, subfolderCount: 0, groups, latestRun }] };
  expect(folderPageSummariesMatch(page)).toBe(true);
  expect(folderPageSummariesMatch({ ...page, summaries: [{ ...page.summaries![0]!, suiteCount: 3 }] })).toBe(false);
  expect(folderPageSummariesMatch({ ...page, summaries: [{ ...page.summaries![0]!, latestRun: null }] })).toBe(false);
  expect(folderPageSummariesMatch({ ...page, summaries: [] })).toBe(false);
});

it('binds inline names and preserves valid agent timestamps without assuming synchronized clocks', () => {
  const row = summary(5, 1); const base = row.latestRun!;
  const page = (latestRun: typeof base): SuitePage => ({ scope, items: [suite(5)], summaries: [{ ...row, latestRun }], nextCursor: null });
  expect(suiteListPageMatches(page({ ...base, startedAt: '2099-01-01T00:00:00.000Z' }), scope, { limit: 100 })).toBe(true);
  expect(suiteListPageMatches(page({ ...base, suiteName: 'Other suite' }), scope, { limit: 100 })).toBe(false);
  expect(suiteListPageMatches(page({ ...base, startedAt: '2026-11-09T00:00:00Z' }), scope, { limit: 100 })).toBe(true);
  expect(suiteListPageMatches(page({ ...base, startedAt: '2026-11-09T01:00:00+01:00' }), scope, { limit: 100 })).toBe(true);
  expect(suiteListPageMatches(page({ ...base, startedAt: 'invalid' }), scope, { limit: 100 })).toBe(false);
  expect(suiteListPageMatches(page({ ...base, requestedAt: '2026-11-09T00:01:00Z' }), scope, { limit: 100 })).toBe(false);
});
