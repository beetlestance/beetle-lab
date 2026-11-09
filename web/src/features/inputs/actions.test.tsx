// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { InputRecord } from '@beetle/contracts/api';
import { apiError, deferred, ids, input, json, mount, page, testClient, workspace } from './test-fixtures.js';

afterEach(cleanup);

it('supplies only selected successful status records and retires actions during refresh/error/scope exit', async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  let statusReads = 0;
  const api = testClient(request => {
    if (request.path.includes(ids.b)) return page([], null, ids.b);
    if (request.path.includes('?')) return page();
    statusReads++;
    if (statusReads === 1) return first.promise;
    if (statusReads === 2) return second.promise;
    return json(input({ version: 10 }));
  });
  const renderActions = vi.fn((record: InputRecord) => <span>Action version {record.version}</span>);
  const view = mount(api.client, workspace(), renderActions);
  fireEvent.click(await screen.findByRole('button', { name: 'Read current status for Synthetic dataset' }));
  await waitFor(() => expect(statusReads).toBe(1));
  expect(renderActions).not.toHaveBeenCalled();
  await act(async () => first.resolve(json(input({ version: 9 }))));
  expect(await screen.findByText('Action version 9')).toBeVisible();
  expect(renderActions.mock.calls.every(([record]) => record.version === 9)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh current status' }));
  await waitFor(() => expect(screen.queryByText('Action version 9')).not.toBeInTheDocument());
  const callsDuringRefresh = renderActions.mock.calls.length;
  await act(async () => second.resolve(json(apiError('storage_unavailable'), 503)));
  await screen.findByText(/Showing the last read status/);
  expect(renderActions).toHaveBeenCalledTimes(callsDuringRefresh);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh current status' }));
  expect(await screen.findByText('Action version 10')).toBeVisible();
  view.switchScope(workspace(ids.b));
  expect(screen.queryByText('Action version 10')).not.toBeInTheDocument();
  const callsAfterDeparture = renderActions.mock.calls.length;
  await screen.findByText('No inputs in this workspace.');
  expect(renderActions).toHaveBeenCalledTimes(callsAfterDeparture);
});

it('retires pre-write actions and ignores a status observation started before an unknown deletion', async () => {
  const preWriteRead = deferred<Response>();
  let statusReads = 0;
  const api = testClient(request => {
    if (request.method === 'DELETE') throw new Error('Synthetic response loss');
    if (request.path.includes('?')) return page();
    statusReads++;
    return statusReads === 2 ? preWriteRead.promise : json(input({ version: statusReads === 1 ? 7 : 11 }));
  });
  const renderActions = vi.fn((record: InputRecord) => <span>Action version {record.version}</span>);
  mount(api.client, workspace(), renderActions);
  fireEvent.click(await screen.findByRole('button', { name: 'Read current status for Synthetic dataset' }));
  await screen.findByText('Action version 7');
  fireEvent.click(screen.getByRole('button', { name: 'Delete input' }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh current status' }));
  await waitFor(() => expect(statusReads).toBe(2));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm deletion' }));
  await screen.findByText(/The request outcome is unknown/);
  const callsBeforeStaleRead = renderActions.mock.calls.length;
  await act(async () => preWriteRead.resolve(json(input({ version: 8 }))));
  await screen.findByText('8');
  expect(screen.queryByText(/Action version/)).not.toBeInTheDocument();
  expect(renderActions).toHaveBeenCalledTimes(callsBeforeStaleRead);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh current status' }));
  expect(await screen.findByText('Action version 11')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Replay identical deletion' })).toBeVisible();
});
