// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import overviewFixture from '../../../../contracts/fixtures/api/valid/workspace-overview.json' with {type:'json'};
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { encodeRunListCursor } from '@beetle/contracts/api';
import { routes } from '../../app/routes.js';
import { queryKeys } from '../../app/queries.js';
import { historyPage, ids, json, testClient, mount, run, runId, scope, runRead, deferred, apiError } from './test-fixtures.js';
import { suiteNames } from './history-fixtures.js';
afterEach(cleanup);
const finished = { ...run(), state: 'finished' as const, outcome: 'passed' as const, validationStatus: 'passed' as const };
function overviewRead(path: string) {
  return path.endsWith('/overview') ? json({...overviewFixture,counts:{...overviewFixture.counts,runs:1,finished:1,suites:1},recent:[{id:runId,suiteId:finished.suiteId,revisionId:finished.revisionId,requestedAt:'2026-11-10T00:00:00.000Z',state:'finished',outcome:'passed'}],scope:{...scope,organizationId:path.includes(ids.b)?ids.b:ids.a}}) : undefined;
}
const runLink = (id = runId) => screen.findByRole('link', { name: new RegExp(id) });
it('pages opaque cursors with a 100 item bound and one suite-name read, no per-row fanout', async () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ ...finished, id: i === 0 ? runId : '00000000-0000-4000-8000-' + String(100 - i).padStart(12, '0') }));
  const last = rows.at(-1)!;
  const cursor = encodeRunListCursor({ scope, query: { limit: 100, order: 'newest' }, requestedAt: last.requestedAt, id: last.id });
  const fixture = testClient(request => {
    const names = suiteNames(request.path); if (names) return names;
    if (request.path.includes('/runs?')) return json(historyPage(request.path.includes('cursor=') ? [] : rows, scope, request.path.includes('cursor=') ? null : cursor));
    throw new Error('Unexpected synthetic route');
  });
  mount(fixture.client, routes.runs(ids.a, ids.workspace));
  await runLink();
  expect((await screen.findAllByText('checkout-steady')).length).toBeGreaterThan(0);
  fireEvent.click(screen.getAllByRole('checkbox')[0]!);
  expect(screen.getByText('Baseline')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Older' }));
  await screen.findByText('No more runs.');
  expect(screen.getByRole('navigation', { name: 'Run pages' })).toHaveTextContent('Page 2');
  expect(fixture.records.filter(r => r.path.includes('/runs?'))[1]?.path).toContain('limit=100&cursor=' + cursor);
  fireEvent.click(screen.getByRole('button', { name: 'Newer' }));
  await runLink();
  expect(screen.getByText(/1 selected/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Older' }));
  await screen.findByText('No more runs.');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await runLink();
  expect(fixture.records.at(-1)?.path).not.toContain('cursor=');
  expect(screen.getByText(/1 selected/)).toBeInTheDocument();
  expect(fixture.records.filter(r => r.path.includes('/suites?'))).toHaveLength(1);
  expect(fixture.records.every(r => r.path.includes('/runs?') || r.path.includes('/suites?limit=100'))).toBe(true);
});
it('enables Compare from two finished runs and links baseline first', async () => {
  const other = { ...finished, id: '00000000-0000-4000-8000-000000000002' };
  const fixture = testClient(request => suiteNames(request.path) ?? json(historyPage([finished, other])));
  mount(fixture.client, routes.runs(ids.a, ids.workspace)); await runLink();
  expect(screen.getByRole('button', { name: 'Compare' })).toBeDisabled();
  const [first, second] = screen.getAllByRole('checkbox');
  fireEvent.click(second!); fireEvent.click(first!);
  expect(screen.getByRole('link', { name: 'Compare 2' })).toHaveAttribute('href', routes.comparison(ids.a, ids.workspace, [other.id, runId]));
});
it('shows the empty board when the workspace has no runs', async () => {
  const fixture = testClient(request => suiteNames(request.path) ?? json(historyPage([])));
  mount(fixture.client, routes.runs(ids.a, ids.workspace));
  expect(await screen.findByRole('heading', { name: 'No runs yet' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Open suites' })).toHaveAttribute('href', routes.suites(ids.a, ids.workspace));
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
it('shows pinned badge and note text from the run row', async () => {
  const fixture = testClient(request => suiteNames(request.path) ?? json(historyPage([{ ...finished, pinned: true, pinnedAt: '2026-11-11T00:00:00.000Z', note: 'After cache warm-up', noteVersion: 1 }])));
  mount(fixture.client, routes.runs(ids.a, ids.workspace)); await runLink();
  const table = within(screen.getByRole('table')); expect(table.getByText('Pinned')).toBeVisible(); expect(table.getByText('After cache warm-up')).toBeVisible();
});
it.each(['/organizations/bad/workspaces/no/runs', routes.run(ids.a, ids.workspace, 'bad')])('validates %s before fetch', async path => {
  const fixture = testClient(() => { throw new Error('Unexpected synthetic route'); });
  mount(fixture.client, path); await screen.findByRole('heading', { name: 'Page not found' });
  expect(fixture.records).toHaveLength(0);
});
it('normalizes cache case while retaining organization and UUID representation', () => {
  expect(queryKeys.run(ids.a, ids.workspace, runId)).toEqual(queryKeys.run(ids.a.toUpperCase(), ids.workspace.toUpperCase(), runId));
  expect(queryKeys.runs(ids.a, ids.workspace)).not.toEqual(queryKeys.runs(ids.b, ids.workspace));
  expect(queryKeys.runs(ids.a, ids.workspace)).not.toEqual(queryKeys.runs(`urn:uuid:${ids.a}`, ids.workspace));
});
it('uses fresh organization scope for the same workspace/run IDs and removes old history', async () => {
  const fixture = testClient(request => overviewRead(request.path) ?? suiteNames(request.path) ?? runRead(request));
  mount(fixture.client, routes.runs(ids.a, ids.workspace));
  await runLink();
  fireEvent.click(screen.getByRole('button', { name: 'Switch workspace B' }));
  await waitFor(() => expect(screen.getByRole('link', { name: 'All runs' })).toHaveAttribute('href', routes.runs(ids.b, ids.workspace)));
  fireEvent.click(screen.getByRole('link', { name: 'All runs' }));
  const link = await runLink();
  expect(link).toHaveAttribute('href', routes.run(ids.b, ids.workspace, runId));
  expect(fixture.records.filter(record => record.path.includes('/runs?limit=100')).map(record => record.path)).toEqual([
    `/api/v2/organizations/${ids.a}/workspaces/${ids.workspace}/runs?limit=100&order=newest`,
    `/api/v2/organizations/${ids.b}/workspaces/${ids.workspace}/runs?limit=100&order=newest`,
    // The new workspace overview reads its first page before history refreshes it.
    `/api/v2/organizations/${ids.b}/workspaces/${ids.workspace}/runs?limit=100&order=newest`,
  ]);
});
it('aborts detail ownership and ignores a late old reply after changing scope', async () => {
  const late = deferred<Response>();
  const fixture = testClient(request => request.path.endsWith(`/runs/${runId}`) ? late.promise : overviewRead(request.path) ?? runRead(request));
  mount(fixture.client, routes.run(ids.a, ids.workspace, runId));
  await waitFor(() => expect(fixture.records).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: 'Switch workspace B' }));
  await waitFor(() => expect(screen.getByRole('link', { name: 'All runs' })).toHaveAttribute('href', routes.runs(ids.b, ids.workspace)));
  expect(fixture.records[0]?.signal?.aborted).toBe(true);
  late.resolve(json(run())); await Promise.resolve();
  expect(screen.queryByText('Run detail')).not.toBeInTheDocument();
});
it.each([401, 404, 409, 503])('shows an honest read failure for HTTP %s', async status => {
  const fixture = testClient(() => json(apiError(status === 401 ? 'unpaired' : status === 409 ? 'conflict' : 'storage_unavailable'), status));
  mount(fixture.client, routes.runs(ids.a, ids.workspace));
  await screen.findByRole('alert'); expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
