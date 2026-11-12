// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { encodeRunListCursor } from '@beetle/contracts/api';
import { routes } from '../../app/routes.js';
import { queryKeys } from '../../app/queries.js';
import { ids, json, testClient, mount, run, runId, scope, runRead, deferred, apiError } from './test-fixtures.js';
afterEach(cleanup);
it('pages opaque cursors with a 100 item bound and no suite fanout', async () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ ...run(), state: 'finished' as const, outcome: 'passed' as const, validationStatus: 'passed' as const, id: i === 0 ? runId : '00000000-0000-4000-8000-' + String(100 - i).padStart(12, '0') }));
  const last = rows.at(-1)!;
  const cursor = encodeRunListCursor({ scope, query: { limit: 100, order: 'newest' }, requestedAt: last.requestedAt, id: last.id });
  const fixture = testClient(request => {
    if (request.path.includes('/runs?')) return json({ scope, items: request.path.includes('cursor=') ? [] : rows, nextCursor: request.path.includes('cursor=') ? null : cursor });
    throw new Error('Unexpected synthetic route');
  });
  mount(fixture.client, routes.runs(ids.a, ids.workspace));
  await screen.findByRole('link', { name: runId });
  fireEvent.click(screen.getAllByRole('checkbox')[0]!);
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('No runs match this history query.');
  expect(fixture.records[1]?.path).toContain('limit=100&cursor=' + cursor);
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  await screen.findByRole('link', { name: runId });
  expect(screen.getByText(/1 selected/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('No runs match this history query.');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh history' }));
  await screen.findByRole('link', { name: runId });
  expect(fixture.records.at(-1)?.path).not.toContain('cursor=');
  expect(screen.getByText(/1 selected/)).toBeInTheDocument();
  expect(fixture.records.every(record => record.path.includes('/runs?'))).toBe(true);
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
  const fixture = testClient(runRead);
  mount(fixture.client, routes.runs(ids.a, ids.workspace));
  await screen.findByRole('link', { name: runId });
  fireEvent.click(screen.getByRole('button', { name: 'Switch workspace B' }));
  await screen.findByRole('heading', { name: 'Folders' });
  fireEvent.click(screen.getByRole('link', { name: 'Runs' }));
  const link = await screen.findByRole('link', { name: runId });
  expect(link).toHaveAttribute('href', routes.run(ids.b, ids.workspace, runId));
  expect(fixture.records.filter(record => record.path.includes('/runs?')).map(record => record.path)).toEqual([
    `/api/v2/organizations/${ids.a}/workspaces/${ids.workspace}/runs?limit=100&order=newest`,
    `/api/v2/organizations/${ids.b}/workspaces/${ids.workspace}/runs?limit=100&order=newest`,
  ]);
});
it('aborts detail ownership and ignores a late old reply after changing scope', async () => {
  const late = deferred<Response>();
  const fixture = testClient(request => request.path.endsWith(`/runs/${runId}`) ? late.promise : runRead(request));
  mount(fixture.client, routes.run(ids.a, ids.workspace, runId));
  await waitFor(() => expect(fixture.records).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: 'Switch workspace B' }));
  await screen.findByRole('heading', { name: 'Folders' });
  expect(fixture.records[0]?.signal?.aborted).toBe(true);
  late.resolve(json(run())); await Promise.resolve();
  expect(screen.queryByText('Run detail')).not.toBeInTheDocument();
});
it.each([401, 404, 409, 503])('shows an honest read failure for HTTP %s', async status => {
  const fixture = testClient(() => json(apiError(status === 401 ? 'unpaired' : status === 409 ? 'conflict' : 'storage_unavailable'), status));
  mount(fixture.client, routes.runs(ids.a, ids.workspace));
  await screen.findByRole('alert'); expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
