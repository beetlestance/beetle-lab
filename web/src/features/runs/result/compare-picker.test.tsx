// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { pendingRunHistorySummary } from '@beetle/contracts/api';
import type { Run } from '@beetle/contracts/api';
import { ApiContext } from '../../../app/api.js';
import { createQueryClient } from '../../../app/queries.js';
import { routes } from '../../../app/routes.js';
import { apiError, ids, json, run, testClient } from '../test-fixtures.js';
import { ResultCompare } from './ComparePicker.js';

afterEach(cleanup);
const current: Run = { ...run(), state: 'finished', outcome: 'passed', validationStatus: 'passed' };
const older: Run = { ...current, id: ids.request, requestedAt: '2026-11-09T00:00:00.000Z' };
it('compares saved revision UUIDs without case when labelling a candidate', async () => {
  mount(() => json(page([{ ...older, revisionId: ids.a }])), { ...current, revisionId: ids.a.toUpperCase() });
  fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
  await screen.findByRole('link', { name: /run 1234, revision 2/ });
  expect(screen.queryByText(/different revision/)).not.toBeInTheDocument();
});
function page(items = [current, older]) {
  return {
    scope: current.scope,
    items,
    summaries: items.map(pendingRunHistorySummary),
    nextCursor: null,
    contexts: items.map((r) => ({
      runId: r.id,
      suiteId: r.suiteId,
      revisionId: r.revisionId,
      suiteName: 'Checkout',
      revisionOrdinal: 2,
    })),
  };
}
function mount(handler: Parameters<typeof testClient>[0], record = current) {
  const f = testClient(handler);
  const client = createQueryClient();
  render(
    <MemoryRouter>
      <ApiContext.Provider value={f.client}>
        <QueryClientProvider client={client}>
          <ResultCompare run={record} suiteName="Checkout" />
        </QueryClientProvider>
      </ApiContext.Provider>
    </MemoryRouter>,
  );
  return { ...f, client };
}

it('opens lazily, excludes this run, and makes the chosen candidate the URL baseline', async () => {
  const f = mount(() => json(page()));
  expect(f.records).toHaveLength(0);
  const button = screen.getByRole('button', { name: 'Compare' });
  button.focus();
  fireEvent.click(button);
  const dialog = await screen.findByRole('dialog', { name: 'Compare run 1111 with' });
  const choice = await within(dialog).findByRole('link', { name: /run 1234, revision 2/ });
  expect(choice).toHaveAttribute('href', routes.comparison(ids.a, ids.workspace, [older.id, current.id]));
  expect(within(dialog).queryByRole('link', { name: /run 1111/ })).not.toBeInTheDocument();
  expect(choice).toHaveTextContent('Previous');
  expect(new URL(f.records[0]!.path, 'http://fixture').searchParams.get('suiteId')).toBe(current.suiteId);
  expect(new URL(f.records[0]!.path, 'http://fixture').searchParams.get('limit')).toBe('20');
  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(button).toHaveFocus();
  await waitFor(() => expect(f.client.getQueryCache().findAll()).toHaveLength(0));
  expect(f.records.some((r) => r.method !== 'GET')).toBe(false);
});

it('switches scope to every suite without reading revisions per row', async () => {
  const f = mount(() => json(page()));
  fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
  await screen.findByRole('link', { name: /run 1234, revision 2/ });
  fireEvent.click(screen.getByRole('radio', { name: 'Every suite' }));
  await waitFor(() => expect(f.records).toHaveLength(2));
  expect(new URL(f.records[1]!.path, 'http://fixture').searchParams.has('suiteId')).toBe(false);
  expect(f.records.some((r) => r.path.includes('/revisions/'))).toBe(false);
});

it('fails closed on foreign row metadata and retries explicitly', async () => {
  let fail = true;
  const f = mount(() =>
    fail
      ? json({ ...page(), contexts: page().contexts.map((c) => ({ ...c, revisionId: ids.workspace })) })
      : json(page()),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
  const retry = await screen.findByRole('button', { name: 'Retry candidate runs' });
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  fail = false;
  fireEvent.click(retry);
  expect(await screen.findByRole('link', { name: /run 1234, revision 2/ })).toBeVisible();
  expect(f.records).toHaveLength(2);
});

it('does not offer unfinished backup records for comparison', () => {
  const f = mount(() => json(apiError('storage_unavailable'), 500), {
    ...current,
    state: 'finalizing',
    outcome: 'pending',
    validationStatus: 'pending',
  });
  expect(screen.queryByRole('button', { name: 'Compare' })).not.toBeInTheDocument();
  expect(f.records).toHaveLength(0);
});
