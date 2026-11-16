// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { historyPage, ids, json, testClient, mount, run, deferred } from './test-fixtures.js';
afterEach(cleanup);
const path = routes.runs(ids.a, ids.workspace);
it('applies filters explicitly, fences old replies, resets selection and performs no row reads', async () => {
  const late = deferred<Response>();
  const base = { ...run(), state: 'finished' as const, outcome: 'passed' as const, validationStatus: 'passed' as const };
  const fixture = testClient(request => {
    const url = new URL(request.path, 'http://localhost');
    if (!url.pathname.endsWith('/runs')) throw Error('Unexpected history fanout');
    if (url.searchParams.get('state') === 'active') return late.promise;
    const items = url.searchParams.get('state') === 'queued' ? [] : [base];
    return json(historyPage(items));
  });
  mount(fixture.client, path); const box = await screen.findByRole('checkbox'); fireEvent.click(box);
  expect(screen.getByText(/1 selected/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('State'), { target: { value: 'active' } });
  expect(fixture.records).toHaveLength(1); fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  await waitFor(() => expect(fixture.records).toHaveLength(2));
  expect(screen.getByText(/0 selected/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('State'), { target: { value: 'queued' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  await screen.findByText('No runs match this history query.');
  expect(fixture.records[1]!.signal?.aborted).toBe(true);
  late.resolve(json(historyPage([{ ...run(), state: 'active' }])));
  await Promise.resolve(); expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
  await screen.findByRole('checkbox'); expect(screen.getByLabelText('State')).toHaveValue('');
  expect(fixture.records).toHaveLength(4);
  expect(fixture.records.map(record => new URL(record.path, 'http://localhost').searchParams.get('state'))).toEqual([null, 'active', 'queued', null]);
  fireEvent.change(screen.getByLabelText('Outcome'), { target: { value: 'passed' } });
  fireEvent.change(screen.getByLabelText('Order'), { target: { value: 'oldest' } });
  expect(fixture.records).toHaveLength(4); fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  await waitFor(() => expect(fixture.records).toHaveLength(5));
  expect(fixture.records[4]!.path).toContain('outcome=passed&order=oldest');
});
it('canonicalizes every applied query field in cache identity', () => {
  const key = queryKeys.runsPage(ids.a, ids.workspace);
  expect(key).toEqual(queryKeys.runsPage(ids.a, ids.workspace, '', { limit: 100, order: 'newest' }));
  for (const query of [{ limit: 99 }, { limit: 100, state: 'queued' }, { limit: 100, outcome: 'passed' }, { limit: 100, order: 'oldest' }] as const) {
    expect(key).not.toEqual(queryKeys.runsPage(ids.a, ids.workspace, '', query));
  }
  expect(key).not.toEqual(queryKeys.runsPage(ids.b, ids.workspace));
});
