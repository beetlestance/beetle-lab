// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { deferred, file, folder, ids, input, json, mount, testClient, transfers, workspace } from './test-fixtures.js';

afterEach(cleanup);
function choose() {
  fireEvent.change(screen.getByLabelText('Input file'), { target: { files: [file()] } });
  fireEvent.change(screen.getByLabelText('Input name'), { target: { value: 'Dataset' } });
}
function folders() { return json({ scope: folder().scope, items: [folder()], nextCursor: null }); }

it('has no enabled transfer without the shared transfer context', () => {
  const api = testClient(() => { throw new Error('No requests expected'); });
  mount(api.client, null);
  expect(screen.getByRole('button', { name: 'Upload input' })).toBeDisabled();
  expect(api.records).toHaveLength(0);
});

it('retains just the selected folder across bounded explicit pages and freezes the prepared intent', async () => {
  const pending = deferred<Response>();
  const api = testClient(request => {
    if (request.method === 'POST') return pending.promise;
    const second = request.path.includes('cursor=');
    const record = second ? folder() : { ...folder(), id: ids.parent, name: 'Retained choice' };
    return json({ scope: folder().scope, items: [record], nextCursor: second ? null : 'next' });
  });
  const transfer = transfers();
  const view = mount(api.client, transfer);
  await screen.findByRole('option', { name: 'Retained choice' });
  choose();
  fireEvent.change(screen.getByLabelText('Destination folder'), { target: { value: ids.parent } });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByRole('option', { name: 'Same folder' });
  expect(screen.getByLabelText('Destination folder')).toHaveValue(ids.parent);
  expect(screen.getByRole('option', { name: 'Retained choice (selected)' })).toBeVisible();
  await waitFor(() => expect(view.cache.getQueryCache().getAll()).toHaveLength(1));
  expect(api.records.every(request => request.path.includes('limit=100'))).toBe(true);
  expect(transfer.prepare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Upload input' }));
  await waitFor(() => expect(api.records.filter(request => request.method === 'POST')).toHaveLength(1));
  expect(api.records.at(-1)!.body?.folderId).toBe(ids.parent);
  expect(screen.getByLabelText('Input file')).toBeDisabled();
  expect(screen.getByLabelText('Input name')).toBeDisabled();
  expect(screen.getByLabelText('Destination folder')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel upload' }));
  await act(async () => pending.resolve(json(input({ folderId: ids.parent }), 201)));
  expect(await screen.findByRole('button', { name: 'Replay identical create' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Discard local draft' }));
  expect(await screen.findByRole('button', { name: 'Upload input' })).toBeDisabled();
  expect(screen.getByText(/no backend data was deleted/)).toBeVisible();
  expect(api.records.filter(request => request.method === 'DELETE')).toHaveLength(0);
});

it.each(['workspace', 'client'] as const)('fences a held create on %s departure and retires memory without closing the client', async departure => {
  const pending = deferred<Response>();
  const api = testClient(request => request.method === 'POST' ? pending.promise : folders());
  const transfer = transfers();
  const view = mount(api.client, transfer);
  await screen.findByRole('option', { name: 'Same folder' });
  choose();
  fireEvent.click(screen.getByRole('button', { name: 'Upload input' }));
  await waitFor(() => expect(api.records.filter(request => request.method === 'POST')).toHaveLength(1));
  const request = api.records.find(request => request.method === 'POST')!;
  if (departure === 'workspace') view.switchScope(workspace(ids.b));
  else view.switchClient(transfers());
  expect(request.signal?.aborted).toBe(true);
  await act(async () => pending.resolve(json(input(), 201)));
  expect(transfer.append).not.toHaveBeenCalled();
  expect(transfer.close).not.toHaveBeenCalled();
  expect(screen.queryByText(/Upload complete/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('Input name')).toHaveValue('');
  expect(api.records.filter(record => record.path.endsWith(`/inputs/${ids.folder}`))).toHaveLength(0);
});

it('rejects oversized files before preparation and never displays an exception message', async () => {
  const api = testClient(() => folders());
  const transfer = transfers();
  mount(api.client, transfer);
  await screen.findByRole('option', { name: 'Same folder' });
  fireEvent.change(screen.getByLabelText('Input name'), { target: { value: 'Dataset' } });
  fireEvent.change(screen.getByLabelText('Input file'), { target: { files: [file(8388609)] } });
  expect(screen.getByRole('button', { name: 'Upload input' })).toBeDisabled();
  expect(transfer.prepare).not.toHaveBeenCalled();
  choose();
  transfer.prepare.mockRejectedValue(new Error('PRIVATE_CANARY'));
  fireEvent.click(screen.getByRole('button', { name: 'Upload input' }));
  expect(await screen.findByRole('button', { name: 'Retry preparation' })).toBeEnabled();
  expect(screen.queryByText(/PRIVATE_CANARY/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('Input name')).toHaveValue('Dataset');
});
