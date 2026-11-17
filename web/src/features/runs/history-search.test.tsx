// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { historyPage, ids, json, testClient, mount, run, deferred } from './test-fixtures.js';
import { suiteNames } from './history-fixtures.js';
import { searchField } from './HistoryFilters.js';
import { routes } from '../../app/routes.js';
import { queryKeys } from '../../app/queries.js';
afterEach(cleanup);
const runReads = <T extends { path: string }>(records: T[]) => records.filter(record => record.path.includes('/runs?'));
function search(value: string) {
  const box = screen.getByRole('searchbox', { name: 'Search runs' });
  fireEvent.change(box, { target: { value } }); fireEvent.submit(box.closest('form')!);
}
it('applies normalized search on submit, fences late replies, and validates before requests', async () => {
  const late = deferred<Response>();
  const fixture = testClient(request => {
    const names = suiteNames(request.path); if (names) return names;
    const url = new URL(request.path, 'http://localhost');
    if (!url.pathname.endsWith('/runs')) throw Error('Unexpected search fanout');
    if (url.searchParams.get('name') === 'first') return late.promise;
    return json(historyPage(url.searchParams.has('name') ? [] : [run()]));
  });
  mount(fixture.client, routes.runs(ids.a, ids.workspace)); await screen.findByRole('checkbox');
  search('ab');
  expect(await screen.findByText(/at least 3 characters/)).toBeVisible(); expect(runReads(fixture.records)).toHaveLength(1);
  search(' FIRST ');
  await waitFor(() => expect(runReads(fixture.records)).toHaveLength(2));
  search('second'); await screen.findByRole('heading', { name: 'No runs match these filters' });
  expect(runReads(fixture.records)[1]!.signal?.aborted).toBe(true); late.resolve(json(historyPage([run()])));
  await Promise.resolve(); expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: 'Reset filters' })[0]!); await screen.findByRole('checkbox');
  expect(screen.getByRole('searchbox', { name: 'Search runs' })).toHaveValue('');
  search('00000000');
  await waitFor(() => expect(runReads(fixture.records)).toHaveLength(5));
  const last = new URL(runReads(fixture.records)[4]!.path, 'http://localhost');
  expect(last.searchParams.get('runIdPrefix')).toBe('00000000'); expect(last.searchParams.has('name')).toBe(false);
});
it('routes hex prefixes to run IDs and other text to names and notes', () => {
  expect(searchField('a7f2c3d1')).toBe('runIdPrefix');
  expect(searchField('11111111-1111')).toBe('runIdPrefix');
  expect(searchField('a7f2')).toBe('name');
  expect(searchField('cache warm-up')).toBe('name');
});
it('normalizes search identity while keeping distinct modes and unfiltered command search separate', () => {
  const key = (query: Parameters<typeof queryKeys.runsPage>[3]) => queryKeys.runsPage(ids.a, ids.workspace, '', query);
  expect(key({ limit: 100, name: ' ＡＢＣ ' })).toEqual(key({ limit: 100, name: 'abc' }));
  expect(key({ limit: 100, name: 'abcdef01' })).not.toEqual(key({ limit: 100, runIdPrefix: 'abcdef01' }));
  expect(key({ limit: 100, name: 'abc' })).not.toEqual(key({ limit: 100 }));
});
