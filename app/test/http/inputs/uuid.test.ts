import { afterEach, expect, it } from 'vitest';
import { validateApi } from '@beetle/contracts/api';
import type { FastifyRequest } from 'fastify';
import type { WorkspaceScope } from '@beetle/contracts/api';
import { storageFixture, command } from '../../storage/fixture.js';
import { setup, digest, requestId } from './fixture.js';
import type { App } from './fixture.js';
import { routeParams } from '../../../src/adapters/inbound/http/inputs/validation.js';
const fixture = storageFixture();
const apps: App[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });
const owner: WorkspaceScope = { kind: 'workspace', organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
const other: WorkspaceScope = { kind: 'workspace', organizationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  workspaceId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' };
const path = (scope: WorkspaceScope) => `/api/v2/organizations/${scope.organizationId.toUpperCase()}/workspaces/${scope.workspaceId.toUpperCase()}/inputs`;
async function seedOwner(app: App, scope: WorkspaceScope, rootFolderId: string, slug: string): Promise<void> {
  await app.metadata.namespaces.execute(command({ kind: 'createOrganization', id: scope.organizationId,
    request: { requestId: requestId(), scope: { kind: 'installation' }, name: slug, slug } }));
  await app.metadata.namespaces.execute(command({ kind: 'createWorkspace', id: scope.workspaceId, rootFolderId,
    request: { requestId: requestId(), scope: { kind: 'organization', organizationId: scope.organizationId }, name: 'Synthetic workspace' } }));
}
it('accepts exactly the shipped UUID format and normalizes captured route params', () => {
  const params = { organizationId: owner.organizationId.toUpperCase(), workspaceId: owner.workspaceId.toUpperCase(),
    inputId: 'CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC' };
  expect(validateApi('InputParams', params).ok).toBe(true);
  const request = { params } as FastifyRequest;
  const canonical = { organizationId: owner.organizationId, workspaceId: owner.workspaceId, inputId: params.inputId.toLowerCase() };
  expect(routeParams(request)).toEqual(canonical); expect(request.params).toEqual(canonical);
});
it('uses uppercase paired CRUD/chunk/content paths with canonical replies and actual namespace isolation', async () => {
  const app = await setup(fixture); apps.push(app);
  await seedOwner(app, owner, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'upper-owner');
  await seedOwner(app, other, 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'upper-other');
  const base = path(owner); const content = 'Uppercase π';
  const bodyScope = { ...owner, organizationId: owner.organizationId.toUpperCase(), workspaceId: owner.workspaceId.toUpperCase() };
  const payload = { scope: bodyScope, requestId: requestId(), name: 'Uppercase synthetic input', bytes: Buffer.byteLength(content), sha256: digest(content) };
  const created = await app.server.inject({ method: 'POST', url: base, headers: app.headers, payload });
  expect(created.statusCode).toBe(201); const record = created.json();
  expect(record.scope).toEqual(owner); expect(record.id).toBe(record.id.toLowerCase());
  const url = `${base}/${record.id.toUpperCase()}`;
  expect((await app.server.inject({ url, headers: app.headers })).json()).toEqual(record);
  const list = await app.server.inject({ url: `${base}?limit=100`, headers: app.headers });
  expect(list.statusCode).toBe(200); expect(list.json()).toMatchObject({ scope: owner, items: [{ id: record.id }] });
  const uploaded = await app.server.inject({ method: 'PUT', url: `${url}/chunks?offset=0`, headers: {
    ...app.headers, 'content-type': 'application/octet-stream' }, payload: Buffer.from(content) });
  expect(uploaded.statusCode).toBe(200); expect(uploaded.json()).toMatchObject({ id: record.id, scope: owner, version: 2 });
  const sealed = await app.server.inject({ method: 'POST', url: `${url}/seal`, headers: app.headers,
    payload: { scope: owner, requestId: requestId(), expectedVersion: 2 } });
  expect(sealed.statusCode).toBe(202); expect(sealed.json()).toMatchObject({ id: record.id, scope: owner, operation: 'seal' });
  const download = await app.server.inject({ url: `${url}/content`, headers: app.headers });
  expect(download.statusCode).toBe(200); expect(download.body).toBe(content);
  expect(download.headers['content-disposition']).toBe(`attachment; filename="input-${record.id}.bin"`);
  expect(download.headers.etag).toBe(`"${digest(content)}"`);
  const wrong = `${path(other)}/${record.id.toUpperCase()}`;
  for (const suffix of ['', '/content']) {
    expect((await app.server.inject({ url: `${wrong}${suffix}`, headers: app.headers })).statusCode).toBe(404);
  }
  const wrongUpload = await app.server.inject({ method: 'PUT', url: `${wrong}/chunks?offset=0`, headers: {
    ...app.headers, 'content-type': 'application/octet-stream' }, payload: Buffer.from(content) });
  expect(wrongUpload.statusCode).toBe(404);
  for (const [method, suffix] of [['POST', '/seal'], ['DELETE', '']] as const) {
    const rejected = await app.server.inject({ method, url: `${wrong}${suffix}`, headers: app.headers,
      payload: { scope: other, requestId: requestId(), expectedVersion: 4 } });
    expect(rejected.statusCode).toBe(404);
  }
  const wrongList = await app.server.inject({ url: `${path(other)}?limit=100`, headers: app.headers });
  expect(wrongList.statusCode).toBe(200); expect(wrongList.json()).toMatchObject({ scope: other, items: [] });
  const second = await app.server.inject({ method: 'POST', url: base, headers: app.headers,
    payload: { ...payload, requestId: requestId(), name: 'Second input', bytes: 0, sha256: digest('') } });
  expect(second.statusCode).toBe(201);
  const firstPage = await app.server.inject({ url: `${base}?limit=1`, headers: app.headers });
  expect(firstPage.statusCode).toBe(200); expect(firstPage.json().scope).toEqual(owner);
  expect(firstPage.json().nextCursor).toEqual(expect.any(String));
  const nextPage = await app.server.inject({ url: `${base.toLowerCase()}?limit=1&cursor=${encodeURIComponent(firstPage.json().nextCursor)}`, headers: app.headers });
  expect(nextPage.statusCode).toBe(200); expect(nextPage.json().scope).toEqual(owner);
  expect(new Set([firstPage.json().items[0].id, nextPage.json().items[0].id])).toEqual(new Set([record.id, second.json().id]));
  const removed = await app.server.inject({ method: 'DELETE', url, headers: app.headers,
    payload: { scope: owner, requestId: requestId(), expectedVersion: 4 } });
  expect(removed.statusCode).toBe(202); expect(removed.json()).toMatchObject({ id: record.id, scope: owner, operation: 'delete' });
  expect((await app.server.inject({ url, headers: app.headers })).json()).toMatchObject({ state: 'deleted', scope: owner });
});
