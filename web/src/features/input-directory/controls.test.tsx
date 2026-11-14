// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act, cleanup, fireEvent, screen, waitFor, render} from '@testing-library/react';
import {afterEach, expect, it} from 'vitest';
import {QueryClientProvider} from '@tanstack/react-query';
import type {Workspace} from '@beetle/contracts/api';
import {ApiContext, InputTransferContext} from '../../app/api.js';
import {createQueryClient} from '../../app/queries.js';
import {UploadInput} from '../input-upload/index.js';
import {DirectoryInput} from './index.js';
import {deferred, directoryFixture, ids, json, selected, workspace} from './test-fixtures.js';
afterEach(cleanup);
function mount(test: ReturnType<typeof directoryFixture>) {
  const cache = createQueryClient();
  const view = (scope: Workspace) => <ApiContext.Provider value={test.api.client}><InputTransferContext.Provider value={test.transfer}>
    <QueryClientProvider client={cache}><UploadInput workspace={scope} /><DirectoryInput workspace={scope} /></QueryClientProvider>
  </InputTransferContext.Provider></ApiContext.Provider>;
  const rendered = render(view(workspace()));
  return {...rendered, cache, switchScope: () => rendered.rerender(view(workspace(ids.b)))};
}
it('offers separate labeled destinations, previews without reading, imports and clears its local draft', async () => {
  const test = directoryFixture(); mount(test);
  expect(screen.getAllByLabelText('Destination folder')).toHaveLength(2);
  expect(screen.getByLabelText('Input directory')).toHaveAttribute('webkitdirectory');
  fireEvent.change(screen.getByLabelText('Input directory'), {target: {files: [selected('tree/a'), selected('tree/nested/b')]}});
  expect(screen.getByText('2 files, 2 folders, 6 bytes selected.')).toBeVisible(); expect(test.transfer.prepare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', {name: 'Import directory'}));
  expect(await screen.findByText('tree/a: published')).toBeVisible();
  expect(await screen.findByText('tree/nested/b: published')).toBeVisible();
  fireEvent.click(await screen.findByRole('button', {name: 'Clear completed directory draft'}));
  expect(screen.queryByText('tree/a: published')).toBeNull(); expect(test.inputs.size).toBe(2);
  expect(screen.getByLabelText('Input directory')).toBeEnabled();
});
it('rejects invalid selection before mutation and fences a held import when its workspace changes', async () => {
  const test = directoryFixture(); const view = mount(test);
  fireEvent.change(screen.getByLabelText('Input directory'), {target: {files: [selected('tree/../a')]}});
  expect(screen.getByRole('alert')).toHaveTextContent(/unsupported/);
  expect(test.transfer.prepare).not.toHaveBeenCalled();
  const pending = deferred<Awaited<ReturnType<typeof test.transfer.prepare>>>(); test.transfer.prepare.mockReturnValueOnce(pending.promise);
  fireEvent.change(screen.getByLabelText('Input directory'), {target: {files: [selected('tree/a'), selected('tree/b')]}});
  fireEvent.click(screen.getByRole('button', {name: 'Import directory'}));
  await waitFor(() => expect(test.transfer.prepare).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText('Input directory')).toBeDisabled();
  const calls = test.api.records.length; view.switchScope();
  await act(async () => pending.resolve({ok: true, value: {sha256: 'a'.repeat(64), content: new Uint8Array(3)}}));
  expect(test.api.records.slice(calls).every(row => row.method === 'GET')).toBe(true);
  expect(test.inputs.size).toBe(0); expect(screen.queryByText('tree/a: current')).toBeNull();
  expect(test.transfer.close).not.toHaveBeenCalled();
});

it('retires a held folder create when the workspace changes without touching the replacement scope', async () => {
  const pending = deferred<Response>(); const test = directoryFixture(undefined, () => pending.promise);
  const view = mount(test);
  fireEvent.change(screen.getByLabelText('Input directory'), {target: {files: [selected('tree/a'), selected('tree/b')]}});
  fireEvent.click(screen.getByRole('button', {name: 'Import directory'}));
  await waitFor(() => expect(test.folders).toHaveLength(2)); view.switchScope();
  await act(async () => pending.resolve(json(test.folders[1], 201)));
  expect(test.transfer.prepare).not.toHaveBeenCalled(); expect(test.inputs.size).toBe(0);
  expect(screen.queryByText('tree/a: current')).toBeNull(); expect(screen.getByLabelText('Input directory')).toBeEnabled();
});
