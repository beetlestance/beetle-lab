// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { InputRecord } from '@beetle/contracts/api';
import { ids, json, mount, readNamespace, testClient, workspace } from './test-fixtures.js';
import { routes } from './routes.js';

afterEach(cleanup);
const record: InputRecord = { id: '11111111-1111-4111-8111-111111111111', version: 3,
  scope: { kind: 'workspace', organizationId: ids.a, workspaceId: ids.workspace }, folderId: ids.root,
  name: 'Route fixture input', bytes: 3, offset: 3, sha256: 'a'.repeat(64), state: 'published', reason: null };
const base = `/api/v2/organizations/${ids.a}/workspaces/${ids.workspace}/inputs`;

it('opens the scoped inventory from its workspace link and reads selected current status', async () => {
  const api = testClient(request => {
    if (request.path === `${base}?limit=100`) return json({ scope: record.scope, items: [record], nextCursor: null });
    if (request.path === `${base}/${record.id}`) return json(record);
    return readNamespace(request);
  });
  mount(api.client, routes.workspace(ids.a, ids.workspace));
  fireEvent.click(await screen.findByRole('link', { name: 'Inputs' }));
  expect(await screen.findByRole('heading', { name: 'Inputs' })).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: `Read current status for ${record.name}` }));
  expect(await screen.findByRole('heading', { name: 'Current input status' })).toBeTruthy();
  expect(await screen.findByRole('button', { name: 'Delete input' })).toBeTruthy();
  expect(api.records.filter(request => request.path === `${base}/${record.id}`)).toHaveLength(1);
});

it('supports direct inventory navigation without querying the folder or suite list', async () => {
  const api = testClient(request => request.path === `${base}?limit=100`
    ? json({ scope: record.scope, items: [], nextCursor: null }) : readNamespace(request));
  mount(api.client, routes.inputs(ids.a, ids.workspace));
  expect(await screen.findByText('No inputs in this workspace.')).toBeTruthy();
  expect(api.records.some(request => /\/(folders|suites)\?/.test(request.path))).toBe(false);
  expect(screen.getByText(workspace().name, { selector: 'strong' })).toBeTruthy();
});

it('rejects malformed input namespace routes before issuing scoped reads', async () => {
  const api = testClient(() => { throw new Error('Unexpected route read'); });
  mount(api.client, routes.inputs('invalid', ids.workspace));
  expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
  expect(api.records).toHaveLength(0);
});
