// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { deferred, folder, ids, json, mount, org, readNamespace, testClient, workspace } from './test-fixtures.js';
import { routes } from './routes.js';

afterEach(cleanup);
describe('URL scope and cancellation', () => {
  it.each(['not-a-uuid', 'urn:uuid:not-a-uuid', 'urn:uuid:' + ids.a + '/extra', ids.a + '%2Fextra'])('rejects malformed route UUIDs before any API call: %s', async invalid => {
    const api = testClient(readNamespace);
    mount(api.client, `/organizations/${invalid}`);
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeVisible();
    expect(api.records).toHaveLength(0);
  });
  it.each([`urn:uuid:${ids.a}`, `URN:UUID:${ids.a.toUpperCase()}`, ids.a.toUpperCase()])('navigates schema-valid UUID representation %s without rewriting identity', async organizationId => {
    const workspaceId = `urn:uuid:${ids.workspace.toUpperCase()}`;
    const api = testClient(request => {
      const path = decodeURIComponent(request.path);
      if (path === '/api/v2/organizations?limit=100') return json({ scope: { kind: 'installation' }, items: [org(organizationId)], nextCursor: null });
      if (path.endsWith(`/organizations/${organizationId}`)) return json(org(organizationId));
      const scopedWorkspace = { ...workspace(organizationId), id: workspaceId };
      if (path.includes('/workspaces?')) return json({ scope: scopedWorkspace.scope, items: [scopedWorkspace], nextCursor: null });
      if (path.endsWith(`/workspaces/${workspaceId}`)) return json(scopedWorkspace);
      if (path.includes('/folders?')) return json({ scope: { kind: 'workspace', organizationId, workspaceId }, items: [], nextCursor: null });
      throw new Error('Unexpected UUID representation route');
    });
    mount(api.client);
    fireEvent.click(await screen.findByRole('link', { name: 'Same organization' }));
    const link = await screen.findByRole('link', { name: 'Same workspace' });
    expect(link).toHaveAttribute('href', routes.workspace(organizationId, workspaceId));
    fireEvent.click(link);
    expect(await screen.findByRole('heading', { name: 'No folders yet' })).toBeVisible();
    expect(api.records.some(record => record.path.includes(encodeURIComponent(organizationId)))).toBe(true);
    expect(api.records.some(record => record.path.includes(encodeURIComponent(workspaceId)))).toBe(true);
  });
  it('cancels a departed organization list and ignores its late same-name reply', async () => {
    const late = deferred<Response>();
    const api = testClient(request => request.path.includes(`${ids.a}/workspaces?`) ? late.promise : readNamespace(request));
    mount(api.client, routes.organization(ids.a));
    await waitFor(() => expect(api.records.some(record => record.path.includes(`${ids.a}/workspaces?`))).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Switch organization B' }));
    expect(screen.queryByRole('link', { name: 'Same workspace' })).not.toBeInTheDocument();
    const link = await screen.findByRole('link', { name: 'Same workspace' });
    expect(link).toHaveAttribute('href', routes.workspace(ids.b, ids.workspace));
    const departed = api.records.find(record => record.path.includes(`${ids.a}/workspaces?`));
    expect(departed?.signal?.aborted).toBe(true);
    await act(async () => { late.resolve(json({ scope: workspace().scope, items: [workspace()], nextCursor: null })); });
    expect(screen.getByRole('link', { name: 'Same workspace' })).toHaveAttribute('href', routes.workspace(ids.b, ids.workspace));
    expect(api.records.every(record => record.method === 'GET')).toBe(true);
  });
  it('clears old folder rows immediately and cannot repaint them after switching workspaces', async () => {
    const late = deferred<Response>();
    const api = testClient(request => request.path.includes(`${ids.b}/workspaces/${ids.workspace}/folders?`) ? late.promise : readNamespace(request));
    mount(api.client, routes.workspace(ids.a, ids.workspace));
    expect(await screen.findByText('/Services/Same folder')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Switch workspace B' }));
    expect(screen.queryByText('/Services/Same folder')).not.toBeInTheDocument();
    await waitFor(() => expect(api.records.some(record => record.path.includes(`${ids.b}/workspaces/${ids.workspace}/folders?`))).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Switch workspace A' }));
    expect(await screen.findByText('/Services/Same folder')).toBeVisible();
    expect(api.records.find(record => record.path.includes(`${ids.b}/workspaces/${ids.workspace}/folders?`))?.signal?.aborted).toBe(true);
    await act(async () => { late.resolve(json({ scope: folder(ids.b).scope, items: [{ ...folder(ids.b), name: 'Late B folder' }], nextCursor: null })); });
    expect(screen.queryByText('Late B folder')).not.toBeInTheDocument();
  });
  it('keeps page size bounded and navigates one page per explicit action', async () => {
    const backReply = deferred<Response>();
    let firstReads = 0;
    const api = testClient(request => {
      if (request.path.includes('?limit=100&cursor=')) return json({ scope: { kind: 'installation' }, items: [org(ids.b)], nextCursor: 'third' });
      firstReads++;
      return firstReads === 1 ? json({ scope: { kind: 'installation' }, items: [org()], nextCursor: 'second' }) : backReply.promise;
    });
    mount(api.client);
    await screen.findByRole('link', { name: 'Same organization' });
    expect(api.records).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText('two')).toBeVisible());
    expect(api.records).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(api.records).toHaveLength(3));
    expect(screen.queryByText('one')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    await act(async () => backReply.resolve(json({ scope: { kind: 'installation' }, items: [org()], nextCursor: 'second' })));
    expect(await screen.findByText('one')).toBeVisible();
    expect(api.records.every(record => record.path.includes('limit=100'))).toBe(true);
  });
});
