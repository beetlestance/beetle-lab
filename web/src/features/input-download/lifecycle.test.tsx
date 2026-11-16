// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { InputRecord, InputTransferResult } from '@beetle/contracts/api';
import { deferred, input, mount, observeFiles, transfers } from './test-fixtures.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('aborts cancel, retains the one in-flight guard through original settlement, and ignores late success', async () => {
  const files = observeFiles();
  const { client, download } = transfers();
  const reply = deferred<InputTransferResult<Uint8Array>>();
  download.mockReturnValueOnce(reply.promise);
  mount(client);
  fireEvent.click(screen.getByRole('button', { name: 'Download input' }));
  const signal = download.mock.calls[0]?.[0].signal;
  fireEvent.click(screen.getByRole('button', { name: 'Cancel download' }));
  expect(signal?.aborted).toBe(true);
  expect(screen.getByRole('status')).toHaveTextContent('Cancelling download…');
  fireEvent.click(screen.getByRole('button', { name: 'Download input' }));
  expect(download).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Cancel download' })).toBeDisabled();
  await act(async () => reply.resolve({ ok: true, value: new Uint8Array(3) }));
  expect(screen.getByRole('status')).toHaveTextContent('Download cancelled.');
  expect(files.blobs).toHaveLength(0);
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry download' }));
  await screen.findByRole('link');
  expect(download).toHaveBeenCalledTimes(2);
  expect(client.close).not.toHaveBeenCalled();
});

const recordChanges: { field: string; change: Partial<InputRecord> }[] = [
  { field: 'version', change: { version: 8 } },
  { field: 'id', change: { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' } },
  { field: 'scope organization', change: { scope: { ...input().scope, organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } } },
  { field: 'scope workspace', change: { scope: { ...input().scope, workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } } },
  { field: 'folder', change: { folderId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } },
  { field: 'name', change: { name: 'Replacement synthetic input' } },
  { field: 'hash', change: { sha256: 'b'.repeat(64) } },
  { field: 'size', change: { bytes: 4, offset: 4 } },
  { field: 'offset', change: { offset: 2 } },
  { field: 'state', change: { state: 'deleting' } },
  { field: 'reason', change: { reason: 'integrity' } },
];
it.each(recordChanges)('aborts and ignores late success after record $field changes', async ({ change }) => {
  const files = observeFiles();
  const { client, download } = transfers();
  const reply = deferred<InputTransferResult<Uint8Array>>();
  download.mockReturnValue(reply.promise);
  const view = mount(client);
  fireEvent.click(screen.getByRole('button', { name: 'Download input' }));
  const signal = download.mock.calls[0]?.[0].signal;
  view.replace(client, input(change));
  expect(signal?.aborted).toBe(true);
  await act(async () => reply.resolve({ ok: true, value: new Uint8Array(3) }));
  expect(files.createObjectURL).not.toHaveBeenCalled();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(client.close).not.toHaveBeenCalled();
});

it.each(['unmount', 'remove context', 'replace context'] as const)('fences late completion on %s', async departure => {
  const files = observeFiles();
  const original = transfers();
  const replacement = transfers();
  const reply = deferred<InputTransferResult<Uint8Array>>();
  original.download.mockReturnValue(reply.promise);
  const view = mount(original.client);
  fireEvent.click(screen.getByRole('button', { name: 'Download input' }));
  const signal = original.download.mock.calls[0]?.[0].signal;
  if (departure === 'unmount') view.unmount();
  else view.replace(departure === 'remove context' ? null : replacement.client);
  expect(signal?.aborted).toBe(true);
  await act(async () => reply.resolve({ ok: true, value: new Uint8Array(3) }));
  expect(files.blobs).toHaveLength(0);
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(original.client.close).not.toHaveBeenCalled();
  if (departure === 'replace context') {
    fireEvent.click(screen.getByRole('button', { name: 'Download input' }));
    await screen.findByRole('link');
    expect(replacement.download).toHaveBeenCalledTimes(1);
  }
});

it.each(['record', 'context', 'missing context', 'unpublished', 'unmount'] as const)('revokes a ready URL on %s departure', async departure => {
  const files = observeFiles();
  const { client } = transfers();
  const view = mount(client);
  fireEvent.click(screen.getByRole('button', { name: 'Download input' }));
  await screen.findByRole('link');
  if (departure === 'unmount') view.unmount();
  else if (departure === 'record') view.replace(client, input({ version: 8 }));
  else if (departure === 'context') view.replace(transfers().client);
  else if (departure === 'missing context') view.replace(null);
  else view.replace(client, input({ state: 'deleting' }));
  expect(files.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:synthetic-1');
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(client.close).not.toHaveBeenCalled();
});
