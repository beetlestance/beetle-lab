// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { apiError, folder, ids, json, mount, org, readNamespace, testClient, workspace } from './test-fixtures.js';
import type { RequestRecord } from './test-fixtures.js';
import { routes } from './routes.js';

afterEach(cleanup);
const field = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));
const mutations = (records: RequestRecord[]) => records.filter(record => record.method !== 'GET');

async function openCreateOrganization() {
  fireEvent.click(await screen.findByRole('button', { name: 'Create organization' }));
  field('Organization name', 'New organization');
  field('Organization slug', 'new-organization');
}

describe('mutation identity and draft ownership', () => {
  it.each([
    { status: 500, code: 'internal_error' as const, operation: 'create' },
    { status: 503, code: 'storage_unavailable' as const, operation: 'create' },
    { status: 500, code: 'internal_error' as const, operation: 'patch' },
    { status: 503, code: 'storage_unavailable' as const, operation: 'patch' },
  ])('replays committed $operation after protocol $status without another effect', async ({ status, code, operation }) => {
    const committed = new Map<string, ReturnType<typeof org> | ReturnType<typeof workspace>>();
    let effects = 0;
    const api = testClient(request => {
      if (request.method === 'GET') return readNamespace(request);
      const requestId = String(request.body?.requestId);
      const previous = committed.get(requestId);
      if (previous) return json(previous, operation === 'create' ? 201 : 200);
      effects++;
      const entity = operation === 'create'
        ? { ...org(), name: 'New organization', slug: 'new-organization' }
        : { ...workspace(), name: 'Updated workspace', version: 4 };
      committed.set(requestId, entity);
      return json(apiError(code), status);
    });
    mount(api.client, operation === 'create' ? '/' : routes.organization(ids.a));
    if (operation === 'create') await openCreateOrganization();
    else {
      fireEvent.click(await screen.findByRole('button', { name: 'Rename Same workspace' }));
      field('Workspace name', 'Updated workspace');
    }
    save();
    expect(await screen.findByText(/The outcome is unknown/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(effects).toBe(1);
    expect(mutations(api.records)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry identical request' }));
    expect(await screen.findByText('Changes saved.')).toBeVisible();
    const writes = mutations(api.records);
    expect(writes).toHaveLength(2);
    expect(writes[1]?.body).toEqual(writes[0]?.body);
    if (operation === 'patch') expect(writes[1]?.body?.expectedVersion).toBe(3);
    expect(effects).toBe(1);
    expect(committed.size).toBe(1);
  });
  it.each([
    { status: 500, code: 'internal_error' as const },
    { status: 503, code: 'storage_unavailable' as const },
  ])('editing after committed protocol $status explicitly starts a new intent', async ({ status, code }) => {
    const committed = new Set<string>();
    const api = testClient(request => {
      if (request.method === 'GET') return readNamespace(request);
      committed.add(String(request.body?.requestId));
      if (committed.size === 1) return json(apiError(code), status);
      return json({ ...org(), name: 'Explicitly edited organization', slug: 'new-organization' }, 201);
    });
    mount(api.client);
    await openCreateOrganization();
    save();
    await screen.findByRole('button', { name: 'Retry identical request' });
    field('Organization name', 'Explicitly edited organization');
    expect(screen.queryByRole('button', { name: 'Retry identical request' })).not.toBeInTheDocument();
    save();
    expect(await screen.findByText('Changes saved.')).toBeVisible();
    const writes = mutations(api.records);
    expect(writes).toHaveLength(2);
    expect(writes[1]?.body?.requestId).not.toEqual(writes[0]?.body?.requestId);
    expect(writes[1]?.body?.name).toBe('Explicitly edited organization');
    expect(committed.size).toBe(2);
  });
  it('replays an unknown create with an identical request ID and payload', async () => {
    let attempts = 0;
    const api = testClient(request => {
      if (request.method === 'POST') {
        attempts++;
        if (attempts === 1) throw new Error('Synthetic lost response');
        return json({ ...org(), name: 'New organization', slug: 'new-organization' }, 201);
      }
      return readNamespace(request);
    });
    mount(api.client);
    await openCreateOrganization();
    save();
    expect(await screen.findByText(/The outcome is unknown/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByLabelText('Organization name')).toHaveValue('New organization');
    expect(mutations(api.records)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry identical request' }));
    await screen.findByText('Changes saved.');
    expect(mutations(api.records)).toHaveLength(2);
    expect(mutations(api.records)[0]?.body).toEqual(mutations(api.records)[1]?.body);
    expect(mutations(api.records)[0]?.body?.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('starts a new intent when editing after an unreadable mutation response', async () => {
    const api = testClient(request => request.method === 'POST' ? new Response('Unreadable', { status: 201 }) : readNamespace(request));
    mount(api.client);
    await openCreateOrganization();
    save();
    await screen.findByRole('button', { name: 'Retry identical request' });
    field('Organization name', 'Changed draft');
    expect(screen.queryByRole('button', { name: 'Retry identical request' })).not.toBeInTheDocument();
    save();
    await waitFor(() => expect(mutations(api.records)).toHaveLength(2));
    expect(mutations(api.records)[0]?.body?.requestId).not.toEqual(mutations(api.records)[1]?.body?.requestId);
    expect(mutations(api.records)[1]?.body?.name).toBe('Changed draft');
  });
  it('preserves a known validation failure without offering unknown-result replay', async () => {
    const api = testClient(request => request.method === 'POST' ? json(apiError('invalid_value'), 422) : readNamespace(request));
    mount(api.client);
    await openCreateOrganization();
    save();
    expect(await screen.findByText('Invalid value')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Retry identical request' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Organization name')).toHaveValue('New organization');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
  it('preserves one scoped draft across organization navigation', async () => {
    const api = testClient(readNamespace);
    mount(api.client, routes.organization(ids.a));
    fireEvent.click(await screen.findByRole('button', { name: 'Create workspace' }));
    field('Workspace name', 'Draft A');
    fireEvent.click(screen.getByRole('button', { name: 'Switch organization B' }));
    expect(await screen.findByRole('link', { name: 'Return to draft' })).toHaveAttribute('href', routes.organization(ids.a));
    expect(screen.queryByLabelText('Workspace name')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Create workspace' })).toBeDisabled();
    fireEvent.click(screen.getByRole('link', { name: 'Return to draft' }));
    expect(await screen.findByLabelText('Workspace name')).toHaveValue('Draft A');
    expect(mutations(api.records)).toHaveLength(0);
  });
  it('renames the organization with its slug and optimistic version, then refreshes conflicts explicitly', async () => {
    let version = 1;
    const api = testClient(request => {
      if (request.method === 'PATCH') return json(apiError('conflict'), 409);
      if (request.path.startsWith('/api/v2/organizations?')) return json({ scope: { kind: 'installation' }, items: [{ ...org(), version }], nextCursor: null });
      return readNamespace(request);
    });
    mount(api.client);
    fireEvent.click(await screen.findByRole('button', { name: 'Rename Same organization' }));
    field('Organization name', 'Edited organization');
    field('Organization slug', 'edited-slug');
    save();
    expect(await screen.findByText('Version or intent conflict')).toBeVisible();
    expect(mutations(api.records)[0]?.body).toMatchObject({ expectedVersion: 1, name: 'Edited organization', slug: 'edited-slug', scope: { kind: 'installation' } });
    version = 2;
    const reads = api.records.length;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh latest version' }));
    await waitFor(() => expect(api.records.length).toBeGreaterThan(reads));
    expect(screen.getByLabelText('Organization name')).toHaveValue('Edited organization');
    expect(mutations(api.records)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename Same organization' }));
    field('Organization name', 'New version edit');
    save();
    await waitFor(() => expect(mutations(api.records)).toHaveLength(2));
    expect(mutations(api.records)[1]?.body?.expectedVersion).toBe(2);
  });
  it('creates and renames an organization-scoped workspace', async () => {
    const api = testClient(request => request.method !== 'GET'
      ? json({ ...workspace(), name: String(request.body?.name), version: 4 }, request.method === 'POST' ? 201 : 200) : readNamespace(request));
    mount(api.client, routes.organization(ids.a));
    fireEvent.click(await screen.findByRole('button', { name: 'Create workspace' }));
    field('Workspace name', 'New workspace'); save();
    await screen.findByText('Changes saved.');
    expect(mutations(api.records)[0]?.body).toMatchObject({ scope: workspace().scope, name: 'New workspace' });
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename Same workspace' }));
    field('Workspace name', 'Renamed workspace'); save();
    await screen.findByText('Changes saved.');
    expect(mutations(api.records)[1]).toMatchObject({ path: `/api/v2/organizations/${ids.a}/workspaces/${ids.workspace}`, method: 'PATCH',
      body: { expectedVersion: 3, scope: workspace().scope, name: 'Renamed workspace' } });
  });
  it('creates, renames and moves a folder using UUID parents and versions', async () => {
    const api = testClient(request => request.method !== 'GET'
      ? json({ ...folder(), version: 8, name: request.body?.name ?? 'Same folder', parentFolderId: request.body?.parentFolderId ?? ids.root }, request.method === 'POST' ? 201 : 200)
      : readNamespace(request));
    mount(api.client, routes.workspace(ids.a, ids.workspace));
    fireEvent.click(await screen.findByRole('button', { name: 'Create folder' }));
    field('Folder name', 'New folder');
    expect(screen.getByLabelText('Parent folder ID')).toHaveValue(ids.root);
    save(); await screen.findByText('Changes saved.');
    expect(mutations(api.records)[0]?.body).toMatchObject({ scope: folder().scope, name: 'New folder', parentFolderId: ids.root });
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename Same folder' }));
    field('Folder name', 'Renamed folder'); save(); await screen.findByText('Changes saved.');
    expect(mutations(api.records)[1]?.body).toMatchObject({ expectedVersion: 7, name: 'Renamed folder', scope: folder().scope });
    expect(mutations(api.records)[1]?.body).not.toHaveProperty('parentFolderId');
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move Same folder' }));
    field('Parent folder ID', `URN:UUID:${ids.parent.toUpperCase()}`); save(); await screen.findByText('Changes saved.');
    expect(mutations(api.records)[2]).toMatchObject({ path: `/api/v2/organizations/${ids.a}/folders/${ids.folder}`, method: 'PATCH',
      body: { expectedVersion: 7, parentFolderId: `URN:UUID:${ids.parent.toUpperCase()}`, scope: folder().scope } });
    expect(mutations(api.records)[2]?.body).not.toHaveProperty('name');
  });
  it('supports labeled fields, initial focus, keyboard submission and explicit discard', async () => {
    const user = userEvent.setup();
    const api = testClient(request => request.method === 'POST' ? json({ ...org(), name: 'Keyboard', slug: 'keyboard' }, 201) : readNamespace(request));
    mount(api.client);
    await user.click(await screen.findByRole('button', { name: 'Create organization' }));
    expect(screen.getByLabelText('Organization name')).toHaveFocus();
    await user.keyboard('Keyboard{Tab}keyboard{Tab}{Enter}');
    expect(await screen.findByText('Changes saved.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Close editor' }));
    await user.click(screen.getByRole('button', { name: 'Create organization' }));
    await user.click(screen.getByRole('button', { name: 'Discard draft' }));
    expect(screen.queryByLabelText('Organization name')).not.toBeInTheDocument();
  });
});
