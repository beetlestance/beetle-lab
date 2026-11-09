// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type * as Api from '@beetle/contracts/api';
import { validateApi } from '@beetle/contracts/api';
import type { InputRecord, InputTransferClient } from '@beetle/contracts/api';
import { browser, session } from '../features/session/test-fixtures.js';
import { apiError, ids, json, readNamespace } from './test-fixtures.js';
import type { RequestRecord } from './test-fixtures.js';
import { routes } from './routes.js';

const factory = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@beetle/contracts/api', async importOriginal => ({
  ...await importOriginal<typeof Api>(), createInputTransferClient: factory.create,
}));
const createUrl = vi.fn(() => 'blob:verified-input'); const revokeUrl = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('URL', class extends URL {
    static override createObjectURL = createUrl;
    static override revokeObjectURL = revokeUrl;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function model() {
  const content = new Uint8Array([97, 98, 99]); let input: InputRecord | undefined; let expired = false;
  const hash = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  const base = `/api/v2/organizations/${ids.a}/workspaces/${ids.workspace}/inputs`;
  const required = () => { if (!input) throw new Error('Synthetic input missing'); return input; };
  const client: InputTransferClient = {
    prepare: vi.fn<InputTransferClient['prepare']>(async () => ({ ok: true, value: { sha256: hash, content } })),
    append: vi.fn<InputTransferClient['append']>(async request => {
      const record = required(); input = { ...record, offset: request.offset + request.chunk.length, version: record.version + 1 };
      return { ok: true, value: input };
    }),
    download: vi.fn<InputTransferClient['download']>(async () => ({ ok: true, value: content })), close: vi.fn(async () => undefined),
  };
  const create = (body: unknown) => {
    const checked = validateApi('CreateInputRequest', body); if (!checked.ok) throw new Error('Invalid synthetic create');
    const value = checked.value; input = { id: ids.folder, scope: value.scope, folderId: value.folderId ?? ids.root,
      name: value.name, sha256: value.sha256, bytes: value.bytes, offset: 0, version: 1, state: 'staging', reason: null };
    return json(input, 201);
  };
  const seal = (body: unknown) => {
    const checked = validateApi('TransitionInputRequest', body); if (!checked.ok) throw new Error('Invalid synthetic seal');
    const record = required(); input = { ...record, state: 'published', version: record.version + 2 };
    return json({ id: input.id, scope: input.scope, requestId: checked.value.requestId,
      operation: 'seal', acceptedVersion: checked.value.expectedVersion + 1 }, 202);
  };
  const http = (request: RequestRecord): Response => {
    if (request.path.endsWith('/auth/session')) return json(session);
    if (request.path === `${base}?limit=100`) return json({ scope: { kind: 'workspace', organizationId: ids.a,
      workspaceId: ids.workspace }, items: input ? [input] : [], nextCursor: null });
    if (request.path === base && request.method === 'POST') return create(request.body);
    if (request.path === `${base}/${ids.folder}`) return expired ? json(apiError('unpaired'), 401) : json(required());
    if (request.path === `${base}/${ids.folder}/seal`) return seal(request.body);
    return readNamespace(request);
  };
  return { client, http, expire: () => { expired = true; } };
}

it('paired session supplies upload/download controls and expiry retires their verified file', async () => {
  const data = model(); factory.create.mockReturnValue(data.client);
  browser(data.http, routes.inputs(ids.a, ids.workspace));
  fireEvent.change(await screen.findByLabelText('Input file'), { target: { files: [new File(['abc'], 'owned.bin')] } });
  fireEvent.change(screen.getByLabelText('Input name'), { target: { value: 'Connected input' } });
  fireEvent.click(screen.getByRole('button', { name: 'Upload input' }));
  expect(await screen.findByText('Upload complete. Published status is confirmed.')).toBeTruthy();
  expect(data.client.prepare).toHaveBeenCalledTimes(1); expect(data.client.append).toHaveBeenCalledTimes(1);
  fireEvent.click(await screen.findByRole('button', { name: 'Read current status for Connected input' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Download input' }));
  const save = await screen.findByRole('link', { name: 'Save file' });
  expect(save.getAttribute('download')).toBe(`input-${ids.folder}.bin`);
  expect(createUrl).toHaveBeenCalledTimes(1); expect(data.client.close).not.toHaveBeenCalled();
  expect(factory.create).toHaveBeenCalledWith(expect.objectContaining({ headers: { 'X-Beetle-CSRF': session.csrfToken } }));
  data.expire(); fireEvent.click(screen.getByRole('button', { name: 'Refresh current status' }));
  await screen.findByLabelText('Startup token');
  await waitFor(() => expect(revokeUrl).toHaveBeenCalledWith('blob:verified-input'));
  expect(screen.queryByRole('link', { name: 'Save file' })).toBeNull();
  expect(data.client.close).toHaveBeenCalledTimes(1);
});
