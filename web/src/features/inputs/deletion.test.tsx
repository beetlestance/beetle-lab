// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { apiError, deferred, ids, input, json, mount, page, receipt, testClient } from './test-fixtures.js';

afterEach(cleanup);

async function openDeletion() {
  fireEvent.click(await screen.findByRole('button', { name: 'Read current status for Synthetic dataset' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Delete input' }));
  return screen.findByRole('button', { name: 'Confirm deletion' });
}

it('requires confirmation, freezes the displayed version and rejects repeated in-flight submits', async () => {
  let version = 7;
  const held = deferred<Response>();
  const api = testClient(request => {
    if (request.method === 'DELETE') return held.promise;
    return request.path.includes('?') ? page() : json(input({ version }));
  });
  mount(api.client);
  await openDeletion();
  expect(api.records.filter(request => request.method === 'DELETE')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel deletion' }));
  expect(screen.queryByRole('button', { name: 'Confirm deletion' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Delete input' }));
  version = 9;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh current status' }));
  await screen.findByText('9');
  expect(screen.getByText(/Delete this input at version 7/)).toBeVisible();
  const confirm = screen.getByRole('button', { name: 'Confirm deletion' });
  fireEvent.click(confirm); fireEvent.click(confirm);
  await waitFor(() => expect(api.records.filter(request => request.method === 'DELETE')).toHaveLength(1));
  const deletion = api.records.find(request => request.method === 'DELETE');
  expect(deletion?.body).toEqual({ scope: input().scope, requestId: expect.any(String), expectedVersion: 7 });
  expect(screen.getByRole('button', { name: 'Close current status' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Replay identical deletion' })).not.toBeInTheDocument();
  await act(async () => held.resolve(receipt(deletion?.body)));
  expect(await screen.findByText(/Deletion accepted \(202\)/)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Delete input' })).not.toBeInTheDocument();
});

it('preserves exact unknown deletion intent through status and list refresh and replay', async () => {
  let deletes = 0;
  let current = input();
  const api = testClient(request => {
    if (request.method === 'DELETE') {
      if (++deletes === 1) throw new Error('Synthetic lost response');
      return receipt(request.body);
    }
    return request.path.includes('?') ? page() : json(current);
  });
  mount(api.client);
  fireEvent.click(await openDeletion());
  expect(await screen.findByText(/The request outcome is unknown/)).toBeVisible();
  const original = api.records.find(request => request.method === 'DELETE');
  current = input({ state: 'deleting', version: 11 });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh current status' }));
  await screen.findByText('11');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh input list' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh input list' })).toBeEnabled());
  expect(screen.getByRole('button', { name: 'Close current status' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Clear rejected deletion' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Replay identical deletion' }));
  expect(await screen.findByText(/Deletion accepted \(202\)/)).toBeVisible();
  const attempts = api.records.filter(request => request.method === 'DELETE');
  expect(attempts).toHaveLength(2);
  expect(attempts[1]?.path).toBe(original?.path);
  expect(attempts[1]?.body).toEqual(original?.body);
  expect(attempts[1]?.body?.expectedVersion).toBe(7);
});

it('keeps acceptance distinct from deleting and only shows deleted after an authoritative refresh', async () => {
  let current = input();
  const api = testClient(request => {
    if (request.method === 'DELETE') {
      current = input({ state: 'deleting', offset: 32, version: 8, reason: 'io' });
      return receipt(request.body);
    }
    return request.path.includes('?') ? page() : json(current);
  });
  mount(api.client);
  fireEvent.click(await openDeletion());
  expect(await screen.findByText('Deleting. Storage release is not yet confirmed.')).toBeVisible();
  expect(screen.getByText(/Deletion accepted \(202\)/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Close current status' })).toBeDisabled();
  expect(screen.queryByText('Deleted. The backend has confirmed absence.')).not.toBeInTheDocument();
  expect(api.records.filter(request => request.method === 'DELETE')).toHaveLength(1);
  current = input({ state: 'deleted', version: 9 });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh current status' }));
  expect(await screen.findByText('Deleted. The backend has confirmed absence.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Replay identical deletion' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close current status' }));
  expect(screen.queryByRole('region', { name: 'Current input status' })).not.toBeInTheDocument();
});

it.each(['conflict', 'protected_dependency', 'storage_unavailable'] as const)('presents %s truthfully with explicit rejection handling', async code => {
  const api = testClient(request => {
    if (request.method === 'DELETE') return json(apiError(code), code === 'storage_unavailable' ? 503 : 409);
    return request.path.includes('?') ? page() : json(input());
  });
  mount(api.client);
  fireEvent.click(await openDeletion());
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(apiError(code).message);
  expect(screen.queryByText(/Deletion accepted/)).not.toBeInTheDocument();
  expect(screen.queryByText('Deleted. The backend has confirmed absence.')).not.toBeInTheDocument();
  if (code === 'protected_dependency') expect(alert).toHaveTextContent('Retained references protect this input');
  if (code === 'conflict') expect(alert).toHaveTextContent('Refresh current status');
  if (code === 'storage_unavailable') {
    expect(alert).toHaveTextContent('outcome is unknown');
    expect(screen.queryByRole('button', { name: 'Clear rejected deletion' })).not.toBeInTheDocument();
  } else {
    fireEvent.click(screen.getByRole('button', { name: 'Clear rejected deletion' }));
    expect(screen.getByRole('button', { name: 'Delete input' })).toBeEnabled();
  }
  expect(api.records.filter(request => request.method === 'DELETE')).toHaveLength(1);
});

it('retains an unknown intent even when a later replay returns a conflict and a status refresh fails', async () => {
  let deletes = 0;
  let statusFailed = false;
  const api = testClient(request => {
    if (request.method === 'DELETE') {
      if (++deletes === 1) throw new Error('Synthetic response loss');
      return json(apiError('conflict'), 409);
    }
    if (request.path.includes('?')) return page();
    return statusFailed ? json(apiError('storage_unavailable'), 503) : json(input());
  });
  mount(api.client);
  fireEvent.click(await openDeletion());
  await screen.findByText(/The request outcome is unknown/);
  statusFailed = true;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh current status' }));
  await screen.findByText(/Showing the last read status/);
  fireEvent.click(screen.getByRole('button', { name: 'Replay identical deletion' }));
  await screen.findByText(/The version or deletion intent conflicts/);
  expect(screen.getByText(/The request outcome is unknown/)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Clear rejected deletion' })).not.toBeInTheDocument();
  const attempts = api.records.filter(request => request.method === 'DELETE');
  expect(attempts[1]?.body).toEqual(attempts[0]?.body);
  expect(attempts[0]?.body?.scope).toEqual({ kind: 'workspace', organizationId: ids.a, workspaceId: ids.workspace });
});
