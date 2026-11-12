// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { historyPage, ids, json, testClient, mount, run, deferred } from './test-fixtures.js';
import { routes } from '../../app/routes.js';
import { queryKeys } from '../../app/queries.js';
afterEach(cleanup);
it('applies normalized search explicitly, fences late replies, resets modes and validates before requests', async () => {
  const late = deferred<Response>();
  const fixture = testClient(request => {
    const url = new URL(request.path, 'http://localhost');
    if (!url.pathname.endsWith('/runs')) throw Error('Unexpected search fanout');
    if (url.searchParams.get('name') === 'first') return late.promise;
    return json(historyPage(url.searchParams.has('name') ? [] : [run()]));
  });
  mount(fixture.client, routes.runs(ids.a, ids.workspace)); await screen.findByRole('checkbox');
  fireEvent.change(screen.getByLabelText('History search'), { target: { value: 'ab' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('at least 3 characters'); expect(fixture.records).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('History search'), { target: { value: ' FIRST ' } });
  expect(fixture.records).toHaveLength(1); fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  await waitFor(() => expect(fixture.records).toHaveLength(2));
  fireEvent.change(screen.getByLabelText('History search'), { target: { value: 'second' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' })); await screen.findByText('No runs match this history query.');
  expect(fixture.records[1]!.signal?.aborted).toBe(true); late.resolve(json(historyPage([run()])));
  await Promise.resolve(); expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reset filters' })); await screen.findByRole('checkbox');
  expect(screen.getByLabelText('History search')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('Search by'), { target: { value: 'runIdPrefix' } });
  fireEvent.change(screen.getByLabelText('History search'), { target: { value: '00000000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  await waitFor(() => expect(fixture.records).toHaveLength(5));
  const last = new URL(fixture.records[4]!.path, 'http://localhost');
  expect(last.searchParams.get('runIdPrefix')).toBe('00000000'); expect(last.searchParams.has('name')).toBe(false);
});
it('normalizes search identity while keeping distinct modes and unfiltered command search separate', () => {
  const key = (query: Parameters<typeof queryKeys.runsPage>[3]) => queryKeys.runsPage(ids.a, ids.workspace, '', query);
  expect(key({ limit: 100, name: ' ＡＢＣ ' })).toEqual(key({ limit: 100, name: 'abc' }));
  expect(key({ limit: 100, name: 'abcdef01' })).not.toEqual(key({ limit: 100, runIdPrefix: 'abcdef01' }));
  expect(key({ limit: 100, name: 'abc' })).not.toEqual(key({ limit: 100 }));
});
