// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { apiError, folder, ids, json, mount, readNamespace, testClient } from '../../app/test-fixtures.js';
import { routes } from '../../app/routes.js';

afterEach(cleanup);
it('marks only a confirmed name collision inline, preserves the draft and admits a corrected fresh intent', async () => {
  let writes = 0;
  const api = testClient(request => {
    if (request.method === 'GET') return readNamespace(request);
    writes++;
    return writes === 1 ? json({ ...apiError('conflict'), fields: [{ path: '/name', code: 'conflict' }] }, 409)
      : json({ ...folder(), name: request.body?.name, parentFolderId: ids.root, version: 1 }, 201);
  });
  mount(api.client, routes.suites(ids.a, ids.workspace));
  fireEvent.click(await screen.findByRole('button', { name: 'New folder' }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Smoke' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create folder' }));
  expect(await screen.findByText(/already has a folder called smoke. Names ignore case/)).toBeVisible();
  expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Name')).toHaveValue('Smoke');
  expect(screen.getByRole('button', { name: 'Create folder' })).toBeDisabled();
  expect(screen.queryByText('Reload the current version; your draft is preserved.')).not.toBeInTheDocument();
  const first = api.records.find(row => row.method === 'POST')!;
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Fresh' } });
  expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid');
  fireEvent.click(screen.getByRole('button', { name: 'Create folder' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  const last = api.records.filter(row => row.method === 'POST')[1]!;
  expect(last.body?.requestId).not.toBe(first.body?.requestId);
  expect(last.body?.name).toBe('Fresh');
});
it('shows the designed depth refusal using the selected validated path without doubling the workspace name', async () => {
  const path = ['Same workspace', 'a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const deep = { ...folder(), name: 'g', displayPath: path };
  const api = testClient(request => {
    if (request.method !== 'GET') return json({ ...apiError('invalid_value'), fields: [{ path: '/parentFolderId', code: 'range' }] }, 422);
    if (request.path.includes('/folders?')) return json({ scope: deep.scope, items: [deep], nextCursor: null });
    return readNamespace(request);
  });
  mount(api.client, routes.suites(ids.a, ids.workspace));
  fireEvent.click(await screen.findByRole('button', { name: 'New folder' }));
  await screen.findByRole('option', { name: path.join(' / ') });
  fireEvent.change(screen.getByLabelText('Inside'), { target: { value: ids.folder } });
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Overflow' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create folder' }));
  expect(await screen.findByRole('dialog', { name: 'Folders can’t go deeper here' })).toBeVisible();
  expect(screen.getByText(`${path.join(' / ')} is already 8 levels deep, the most Beetle allows. Create the folder higher up.`)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(api.records.filter(row => row.method === 'POST')).toHaveLength(1);
});
it('keeps an undifferentiated conflict generic instead of claiming a duplicate name', async () => {
  const api = testClient(request => request.method === 'GET' ? readNamespace(request) : json(apiError('conflict'), 409));
  mount(api.client, routes.suites(ids.a, ids.workspace));
  fireEvent.click(await screen.findByRole('button', { name: 'New folder' }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Smoke' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create folder' }));
  expect(await screen.findByText('Reload the current version; your draft is preserved.')).toBeVisible();
  expect(screen.queryByText(/already has a folder called/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('Name')).toHaveValue('Smoke');
});
