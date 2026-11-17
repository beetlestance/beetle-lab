// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { historyPage, ids, json, testClient, mount, run, deferred } from './test-fixtures.js';
import { suiteNames } from './history-fixtures.js';
afterEach(cleanup);
const path = routes.runs(ids.a, ids.workspace);
const runReads = (records: { path: string }[]) => records.filter(record => record.path.includes('/runs?'));
const param = (record: { path: string }, name: string) => new URL(record.path, 'http://localhost').searchParams.get(name);
it('applies chips at once, fences old replies, resets selection and performs no row reads', async () => {
  const late = deferred<Response>();
  const base = { ...run(), state: 'finished' as const, outcome: 'passed' as const, validationStatus: 'passed' as const };
  const fixture = testClient(request => {
    const names = suiteNames(request.path); if (names) return names;
    const url = new URL(request.path, 'http://localhost');
    if (!url.pathname.endsWith('/runs')) throw Error('Unexpected history fanout');
    if (url.searchParams.get('state') === 'active') return late.promise;
    return json(historyPage(url.searchParams.get('state') === 'cancelled' ? [] : [base]));
  });
  mount(fixture.client, path); const box = await screen.findByRole('checkbox'); fireEvent.click(box);
  expect(screen.getByText(/1 selected/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: 'Running' }));
  await waitFor(() => expect(runReads(fixture.records)).toHaveLength(2));
  expect(screen.queryByText(/1 selected/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: 'Cancelled' }));
  await screen.findByRole('heading', { name: 'No runs match these filters' });
  expect(runReads(fixture.records)[1]!.signal?.aborted).toBe(true);
  late.resolve(json(historyPage([{ ...run(), state: 'active' }])));
  await Promise.resolve(); expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: 'Reset filters' })[0]!);
  await screen.findByRole('checkbox'); expect(screen.getByRole('radio', { name: 'All' })).toBeChecked();
  expect(runReads(fixture.records).map(record => param(record, 'state'))).toEqual([null, 'active', 'cancelled', null]);
  fireEvent.click(screen.getByRole('radio', { name: 'Passed' }));
  await waitFor(() => expect(runReads(fixture.records)).toHaveLength(5));
  fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'oldest' } });
  await waitFor(() => expect(runReads(fixture.records)).toHaveLength(6));
  expect(runReads(fixture.records)[5]!.path).toContain('outcome=passed&order=oldest');
});
it('filters pinned runs with a distinct cache entry and filters by suite', async () => {
  const fixture = testClient(request => suiteNames(request.path) ?? json(historyPage([{ ...run(), state: 'finished', outcome: 'passed', validationStatus: 'passed' }])));
  mount(fixture.client, path); await screen.findByRole('checkbox');
  fireEvent.click(screen.getByRole('radio', { name: 'Pinned' }));
  await waitFor(() => expect(runReads(fixture.records)).toHaveLength(2));
  expect(param(runReads(fixture.records)[1]!, 'pinned')).toBe('true');
  await screen.findByRole('option', { name: 'checkout-steady' });
  fireEvent.change(screen.getByLabelText('Suite'), { target: { value: run().suiteId } });
  await waitFor(() => expect(runReads(fixture.records)).toHaveLength(3));
  expect(param(runReads(fixture.records)[2]!, 'suiteId')).toBe(run().suiteId);
  expect(param(runReads(fixture.records)[2]!, 'pinned')).toBe('true');
});
it('canonicalizes every applied query field in cache identity', () => {
  const key = queryKeys.runsPage(ids.a, ids.workspace);
  expect(key).toEqual(queryKeys.runsPage(ids.a, ids.workspace, '', { limit: 100, order: 'newest' }));
  for (const query of [{ limit: 99 }, { limit: 100, state: 'queued' }, { limit: 100, outcome: 'passed' }, { limit: 100, order: 'oldest' }] as const) {
    expect(key).not.toEqual(queryKeys.runsPage(ids.a, ids.workspace, '', query));
  }
  expect(key).not.toEqual(queryKeys.runsPage(ids.b, ids.workspace));
});
