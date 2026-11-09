// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { queryKeys } from '../../app/queries.js';
import { apiError, ids, input, json, mount, page, testClient } from './test-fixtures.js';

afterEach(cleanup);

it('reads bounded metadata and explicit authoritative status without content or transfer actions', async () => {
  const current = input({ state: 'failed', reason: 'integrity', version: 9 });
  const api = testClient(request => request.path.includes('?') ? page() : json(current));
  mount(api.client);
  expect(await screen.findByRole('table', { name: 'Workspace inputs' })).toBeVisible();
  expect(screen.getByRole('columnheader', { name: 'Listed state' })).toBeVisible();
  expect(api.records).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Read current status for Synthetic dataset' }));
  const status = await screen.findByRole('region', { name: 'Current input status' });
  expect(await within(status).findByText('Input integrity verification failed.')).toBeVisible();
  expect(within(status).getByText('a'.repeat(64))).toBeVisible();
  expect(within(status).getByText('64 bytes')).toBeVisible();
  expect(within(status).getByRole('progressbar', { name: 'Committed input bytes' })).toHaveAttribute('value', '32');
  expect(within(status).getByText('9')).toBeVisible();
  expect(screen.queryByRole('button', { name: /upload|download/i })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh current status' }));
  await waitFor(() => expect(api.records).toHaveLength(3));
  expect(api.records.every(request => request.method === 'GET')).toBe(true);
});

it('presents list failure without retry loops and explicitly retries into an empty page', async () => {
  let reads = 0;
  const api = testClient(() => ++reads === 1 ? json(apiError('storage_unavailable'), 503) : page([]));
  mount(api.client);
  expect(await screen.findByRole('alert')).toHaveTextContent('Storage unavailable');
  expect(api.records).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
  expect(await screen.findByText('No inputs in this workspace.')).toBeVisible();
  expect(api.records).toHaveLength(2);
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
});

it('retains only the current page and bounds cursor history at twenty pages', async () => {
  const api = testClient(request => {
    const cursor = new URL('http://localhost' + request.path).searchParams.get('cursor');
    const number = cursor ? Number(cursor.slice(1)) : 0;
    return page([input({ name: `Page ${number}` })], `c${number + 1}`);
  });
  const { cache } = mount(api.client);
  await screen.findByText('Page 0');
  for (let index = 1; index <= 22; index++) {
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText(`Page ${index}`);
    await waitFor(() => expect(cache.getQueryCache().findAll({ queryKey: [...queryKeys.inputs(ids.a, ids.workspace), 'pages'] })).toHaveLength(1));
  }
  for (let index = 21; index >= 2; index--) {
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByText(`Page ${index}`);
  }
  expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  expect(api.records).toHaveLength(43);
  expect(api.records.every(request => request.path.includes('limit=100'))).toBe(true);
});

it('rejects an oversized API page at the existing validated boundary', async () => {
  const api = testClient(() => page(Array.from({ length: 101 }, () => input())));
  mount(api.client);
  expect(await screen.findByRole('alert')).toHaveTextContent('unreadable response');
  expect(screen.queryByText('Synthetic dataset')).not.toBeInTheDocument();
});
