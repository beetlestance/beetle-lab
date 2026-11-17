// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { ApiError } from '@beetle/contracts/api';
import { apiError, ids, input, json, mount, page, testClient } from './test-fixtures.js';
import { formatBytes, shapeText } from './format.js';

afterEach(cleanup);

const ready = input({
  name: 'users.csv',
  state: 'published',
  offset: 4_500_000,
  bytes: 4_500_000,
  createdAt: '2026-11-10T09:00:00.000Z',
  publishedAt: '2026-11-12T09:00:00.000Z',
  rowCount: 1200,
  columnCount: 4,
  usedByCount: 3,
});
const legacy = input({
  id: ids.parent,
  name: 'body.bin',
  state: 'published',
  offset: 4_500_000,
  bytes: 4_500_000,
  createdAt: null,
  publishedAt: null,
  rowCount: null,
  columnCount: null,
  usedByCount: 0,
});

it('lists 032 metadata, omits unmeasured values and totals only a complete inventory', async () => {
  const api = testClient(() => page([ready, legacy]));
  mount(api.client);
  const table = await screen.findByRole('table', { name: 'Workspace inputs' });
  expect(screen.getByText('2 files, 9.0 MB.')).toBeVisible();
  const [, first, second] = within(table).getAllByRole('row');
  expect(first).toHaveTextContent('CSV · 1,200 rows · 4 columns');
  expect(first).toHaveTextContent('Ready');
  expect(first).toHaveTextContent('3 revisions');
  expect(first).toHaveTextContent(
    new Date('2026-11-12T09:00:00.000Z').toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }),
  );
  expect(second).toHaveTextContent('BIN');
  expect(second).not.toHaveTextContent(/rows|columns/);
  expect(second).toHaveTextContent('Not used');
  expect(api.records.every((request) => !request.path.includes('/folders'))).toBe(true);
});

it('reports only the page size when more pages exist', async () => {
  const api = testClient(() => page([ready], 'next-page'));
  mount(api.client);
  expect(await screen.findByText('1 file on this page.')).toBeVisible();
});

it('reads usage for a used input and names revisions', async () => {
  const api = testClient((request) => {
    if (request.path.includes('/usage')) {
      return json({
        scope: ready.scope,
        inputId: ready.id,
        total: 3,
        items: [
          { suiteId: ids.a, suiteName: 'steady-1.2k', revisionId: ids.b, ordinal: 4, current: false },
          { suiteId: ids.a, suiteName: 'steady-1.2k', revisionId: ids.request, ordinal: 5, current: true },
        ],
        nextCursor: 'more',
      });
    }
    return request.path.includes('?') ? page([ready]) : json(ready);
  });
  mount(api.client);
  fireEvent.click(await screen.findByRole('button', { name: 'Read current status for users.csv' }));
  const usage = await screen.findByRole('region', { name: 'Used by' });
  expect(within(usage).getByRole('heading')).toHaveTextContent('Used by 3 saved revisions');
  expect(await within(usage).findByText('Revision 5')).toBeVisible();
  expect(within(usage).getByText('Current')).toBeVisible();
  expect(api.records.find((request) => request.path.includes('/usage'))?.path).toContain('limit=10');
  fireEvent.click(within(usage).getByRole('button', { name: 'More revisions' }));
  await screen.findByRole('button', { name: 'Previous revisions' });
  expect(api.records.filter((request) => request.path.includes('/usage'))[1]?.path).toContain('cursor=more');
});

it('names the delete blockers from the refusal and counts the rest', async () => {
  const refusal: ApiError = {
    ...apiError('protected_dependency'),
    message: 'Protected dependency',
    dependencies: {
      total: 4,
      items: [
        { suiteId: ids.a, suiteName: 'steady-1.2k', revisionId: ids.b, ordinal: 5, current: true },
        { suiteId: ids.a, suiteName: 'steady-1.2k', revisionId: ids.request, ordinal: 4, current: false },
      ],
    },
  };
  const unused = { ...ready, usedByCount: 0 };
  const api = testClient((request) => {
    if (request.method === 'DELETE') return json(refusal, 409);
    return request.path.includes('?') ? page([unused]) : json(unused);
  });
  mount(api.client);
  fireEvent.click(await screen.findByRole('button', { name: 'Read current status for users.csv' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Delete input' }));
  const dialog = screen.getByRole('alertdialog', { name: 'Delete users.csv?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm deletion' }));
  const inUse = await screen.findByRole('alertdialog', { name: 'users.csv is in use' });
  const list = within(inUse).getByRole('list', { name: 'Used by' });
  expect(list).toHaveTextContent('steady-1.2k Revisions 4 and 5 · current revision');
  expect(inUse).toHaveTextContent('…and 2 more saved revisions.');
});

it('formats sizes and shapes without inventing counts', () => {
  expect(formatBytes(999)).toBe('999 bytes');
  expect(formatBytes(9_000_000)).toBe('9.0 MB');
  expect(shapeText(input({ name: 'notes', rowCount: null }))).toBe('');
});
