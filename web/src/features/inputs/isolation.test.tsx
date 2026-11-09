// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { queryKeys } from '../../app/queries.js';
import { deferred, ids, input, json, mount, page, receipt, testClient, workspace } from './test-fixtures.js';

afterEach(cleanup);

it('aborts a departed list, resets pagination and never caches or paints its held late reply', async () => {
  const late = deferred<Response>();
  const bInput = input({ scope: { ...input().scope, organizationId: ids.b }, name: 'Dataset B' });
  const api = testClient(request => request.path.includes(ids.a) ? late.promise
    : page([bInput], null, ids.b));
  const view = mount(api.client);
  await waitFor(() => expect(api.records).toHaveLength(1));
  view.switchScope(workspace(ids.b));
  expect(await screen.findByText('Dataset B')).toBeVisible();
  expect(api.records[0]?.signal?.aborted).toBe(true);
  await act(async () => late.resolve(page([input({ name: 'Late A dataset' })])));
  expect(screen.queryByText('Late A dataset')).not.toBeInTheDocument();
  expect(view.cache.getQueryCache().findAll({ queryKey: queryKeys.inputs(ids.a, ids.workspace) })).toHaveLength(0);
  expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  expect(api.records).toHaveLength(2);
});

it('retires a held status read and cannot paint it over a new scope with the same input ID', async () => {
  const late = deferred<Response>();
  const bInput = input({ scope: { ...input().scope, organizationId: ids.b }, version: 12, sha256: 'b'.repeat(64) });
  const api = testClient(request => {
    const isA = request.path.includes(ids.a);
    if (request.path.includes('?')) return isA ? page() : page([bInput], null, ids.b);
    return isA ? late.promise : json(bInput);
  });
  const view = mount(api.client);
  fireEvent.click(await screen.findByRole('button', { name: 'Read current status for Synthetic dataset' }));
  await waitFor(() => expect(api.records).toHaveLength(2));
  view.switchScope(workspace(ids.b));
  expect(screen.queryByRole('region', { name: 'Current input status' })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Read current status for Synthetic dataset' }));
  const status = await screen.findByRole('region', { name: 'Current input status' });
  expect(await within(status).findByText('b'.repeat(64))).toBeVisible();
  expect(api.records[1]?.signal?.aborted).toBe(true);
  await act(async () => late.resolve(json(input({ name: 'Late A status' }))));
  expect(screen.queryByText('Late A status')).not.toBeInTheDocument();
  expect(within(status).getByText('12')).toBeVisible();
  expect(view.cache.getQueryCache().findAll({ queryKey: queryKeys.inputs(ids.a, ids.workspace) })).toHaveLength(0);
});

it('aborts scoped deletion on departure and ignores its late accepted receipt', async () => {
  const late = deferred<Response>();
  const bInput = input({ scope: { ...input().scope, organizationId: ids.b }, name: 'Dataset B' });
  const api = testClient(request => {
    if (request.method === 'DELETE') return late.promise;
    const isA = request.path.includes(ids.a);
    if (request.path.includes('?')) return isA ? page() : page([bInput], null, ids.b);
    return isA ? json(input()) : json(bInput);
  });
  const view = mount(api.client);
  fireEvent.click(await screen.findByRole('button', { name: 'Read current status for Synthetic dataset' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Delete input' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm deletion' }));
  await waitFor(() => expect(api.records.filter(request => request.method === 'DELETE')).toHaveLength(1));
  const deletion = api.records.find(request => request.method === 'DELETE');
  view.switchScope(workspace(ids.b));
  expect(await screen.findByText('Dataset B')).toBeVisible();
  expect(deletion?.signal?.aborted).toBe(true);
  const readsBefore = api.records.length;
  await act(async () => late.resolve(receipt(deletion?.body)));
  expect(screen.queryByText(/Deletion accepted/)).not.toBeInTheDocument();
  expect(api.records).toHaveLength(readsBefore);
  expect(view.cache.getQueryCache().findAll({ queryKey: queryKeys.inputs(ids.a, ids.workspace) })).toHaveLength(0);
});
