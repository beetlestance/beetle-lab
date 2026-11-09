// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { InputRecord, InputTransferFailure, InputTransferResult } from '@beetle/contracts/api';
import { deferred, input, inputId, mount, observeFiles, transfers } from './test-fixtures.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('hides actions without context or published status', () => {
  const { client, download } = transfers();
  const view = mount(null);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  const states: InputRecord['state'][] = ['staging', 'publishing', 'failed', 'deleting', 'deleted'];
  for (const state of states) {
    view.replace(client, input({ state }));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  }
  expect(download).not.toHaveBeenCalled();
});

it('creates no file before verified success, guards double issue, and exposes an explicit safe save link', async () => {
  const files = observeFiles();
  const { client, download } = transfers();
  const reply = deferred<InputTransferResult<Uint8Array>>();
  download.mockReturnValue(reply.promise);
  const record = input();
  const view = mount(client, record);
  const button = screen.getByRole('button', { name: 'Download input' });
  fireEvent.click(button); fireEvent.click(button);
  expect(download).toHaveBeenCalledTimes(1);
  expect(download.mock.calls[0]?.[0].record).toBe(record);
  expect(download.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal);
  expect(files.blobs).toHaveLength(0);
  expect(files.createObjectURL).not.toHaveBeenCalled();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  await act(async () => reply.resolve({ ok: true, value: new Uint8Array([1, 2, 3]) }));
  const link = screen.getByRole('link', { name: 'Save file' });
  expect(link).toHaveAttribute('download', `input-${inputId}.bin`);
  expect(link).toHaveAttribute('href', 'blob:synthetic-1');
  expect(files.blobs).toHaveLength(1);
  expect(files.blobs[0]?.size).toBe(3);
  expect(files.blobs[0]?.type).toBe('application/octet-stream');
  expect(screen.getByRole('status')).toHaveTextContent('Verified input is ready to save.');
  view.unmount();
  expect(files.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:synthetic-1');
  expect(client.close).not.toHaveBeenCalled();
});

it.each([0, 8 * 1024 * 1024])('accepts a verified exact %i-byte result', async bytes => {
  const files = observeFiles();
  const { client, download } = transfers();
  download.mockResolvedValue({ ok: true, value: new Uint8Array(bytes) });
  mount(client, input({ bytes, offset: bytes }));
  fireEvent.click(screen.getByRole('button', { name: 'Download input' }));
  await screen.findByRole('link', { name: 'Save file' });
  expect(files.blobs[0]?.size).toBe(bytes);
});

it.each([
  { expected: 3, actual: 2 }, { expected: 3, actual: 4 },
  { expected: 3, actual: 8 * 1024 * 1024 + 1 },
  { expected: 8 * 1024 * 1024 + 1, actual: 0 }, { expected: -1, actual: 0 },
  { expected: 1.5, actual: 0 },
])('rejects invalid output bounds before Blob creation: %o', async ({ expected, actual }) => {
  const files = observeFiles();
  const { client, download } = transfers();
  download.mockResolvedValue({ ok: true, value: new Uint8Array(actual) });
  mount(client, input({ bytes: expected }));
  fireEvent.click(screen.getByRole('button', { name: 'Download input' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not download this input. Try again.');
  expect(files.blobs).toHaveLength(0);
  expect(files.createObjectURL).not.toHaveBeenCalled();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

const failures: { failure: InputTransferFailure; message: string }[] = [
  { failure: { kind: 'busy' }, message: 'Input transfers are busy.' },
  { failure: { kind: 'closed' }, message: 'Input transfers are unavailable.' },
  { failure: { kind: 'transport' }, message: 'The service is unavailable.' },
  { failure: { kind: 'response' }, message: 'The service returned an unreadable response.' },
  { failure: { kind: 'timeout' }, message: 'The service did not respond in time.' },
  { failure: { kind: 'protocol' }, message: 'The service could not complete the request.' },
];
it.each(failures)('offers explicit retry after $failure.kind without a file', async ({ failure, message }) => {
  const files = observeFiles();
  const { client, download } = transfers();
  download.mockResolvedValueOnce({ ok: false, error: failure, issued: true });
  mount(client);
  fireEvent.click(screen.getByRole('button', { name: 'Download input' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(download).toHaveBeenCalledTimes(1);
  expect(files.createObjectURL).not.toHaveBeenCalled();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry download' }));
  await screen.findByRole('link', { name: 'Save file' });
  expect(download).toHaveBeenCalledTimes(2);
});

it.each(['throw', 'reject'] as const)('hides private adapter text on %s', async mode => {
  const files = observeFiles();
  const { client, download } = transfers();
  if (mode === 'throw') download.mockImplementation(() => { throw new Error('private canary'); });
  else download.mockRejectedValue(new Error('private canary'));
  mount(client);
  fireEvent.click(screen.getByRole('button', { name: 'Download input' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not download this input. Try again.');
  expect(screen.queryByText(/private canary/)).not.toBeInTheDocument();
  expect(files.createObjectURL).not.toHaveBeenCalled();
});

it('revokes the old ready URL before replacement and keeps no ready file after a replacement failure', async () => {
  const files = observeFiles();
  const { client, download } = transfers();
  mount(client);
  fireEvent.click(screen.getByRole('button', { name: 'Download input' }));
  await screen.findByRole('link');
  download.mockResolvedValueOnce({ ok: false, error: { kind: 'busy' }, issued: false });
  fireEvent.click(screen.getByRole('button', { name: 'Download input' }));
  expect(files.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:synthetic-1');
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Retry download' }));
  expect(await screen.findByRole('link')).toHaveAttribute('href', 'blob:synthetic-2');
});
