import { afterEach, expect, it, vi } from 'vitest';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { encodeJson } from '@beetle/contracts';
import { apiSchemas, validateApi } from '@beetle/contracts/api';
import type { Folder, Organization, Workspace } from '@beetle/contracts/api';
import { createApiServer, ApiFault } from './api-errors.js';
import { configureSchemaCompilers } from './schema-compilers.js';
import { registerNamespaceRoutes } from './namespaces/index.js';
import { classifyMetadataError } from '../../../bootstrap/metadata-errors.js';
import { storageFixture, digest, requestId, uuid } from '../../../../test/storage/fixture.js';
import type { NamespaceReader } from '../../../ports/namespace-reader.js';

const fixture = storageFixture();
const servers: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.close())); });
const auth = { authorization: 'SYNTHETIC_PAIRED_SESSION' };
async function setup(newId?: () => string, readerOverride?: NamespaceReader, path?: string) {
  const metadata = await fixture.open(path);
  let allocation = 40_000;
  const server = createApiServer({ classify: classifyMetadataError }); servers.push(server);
  configureSchemaCompilers(server, { schemas: apiSchemas, encodeJson });
  const authorize = vi.fn(async (request: FastifyRequest) => {
    if (request.headers.authorization !== auth.authorization) throw new ApiFault('unpaired');
  });
  registerNamespaceRoutes(server, { deletions: metadata.namespaceDeletions, store: metadata.namespaces, reader: readerOverride ?? metadata, digest,
    newId: newId ?? (() => uuid(++allocation)), authorize });
  async function org(name: string, slug: string): Promise<Organization> {
    const response = await server.inject({ method: 'POST', url: '/api/v2/organizations', headers: auth,
      payload: { scope: { kind: 'installation' }, requestId: requestId(), name, slug } });
    expect(response.statusCode).toBe(201); return response.json() as Organization;
  }
  async function workspace(organizationId: string, name = 'Service', intent = requestId()): Promise<Workspace> {
    const response = await server.inject({ method: 'POST', url: `/api/v2/organizations/${encodeURIComponent(organizationId)}/workspaces`, headers: auth,
      payload: { scope: { kind: 'organization', organizationId }, requestId: intent, name } });
    expect(response.statusCode).toBe(201); return response.json() as Workspace;
  }
  async function folder(parent: Workspace, name: string, parentFolderId = parent.rootFolderId): Promise<Folder> {
    const response = await server.inject({ method: 'POST', url: `/api/v2/organizations/${parent.scope.organizationId}/workspaces/${parent.id}/folders`, headers: auth,
      payload: { scope: { kind: 'workspace', organizationId: parent.scope.organizationId, workspaceId: parent.id },
        requestId: requestId(), parentFolderId, name } });
    expect(response.statusCode).toBe(201); return response.json() as Folder;
  }
  return { server, metadata, org, workspace, folder, authorize };
}

it('requires an injected authorization guard before reading or mutating namespace storage', async () => {
  const { server, metadata, authorize } = await setup();
  const read = await server.inject('/api/v2/organizations?limit=100');
  expect(read.statusCode).toBe(401); expect(validateApi('ApiError', read.json()).ok).toBe(true);
  const write = await server.inject({ method: 'POST', url: '/api/v2/organizations', payload: {
    requestId: requestId(), scope: { kind: 'installation' }, name: 'Blocked', slug: 'blocked',
  } });
  expect(write.statusCode).toBe(401); expect(authorize).toHaveBeenCalledTimes(2);
  expect((await metadata.list({ kind: 'organization', scope: { kind: 'installation' }, limit: 100 })).items).toEqual([]);
});

it('replays CREATE intent with original identities despite fresh server allocations', async () => {
  const { server, org, workspace } = await setup();
  const team = await org('Synthetic team', 'synthetic-team');
  const intent = requestId();
  const first = await workspace(team.id, 'Service', intent);
  const second = await workspace(team.id, 'Service', intent);
  expect(second).toEqual(first);
  const page = await server.inject({ url: `/api/v2/organizations/${team.id}/workspaces?limit=100`, headers: auth });
  expect(page.statusCode).toBe(200); expect(page.json().items).toEqual([first]);
  const changed = await server.inject({ method: 'POST', url: `/api/v2/organizations/${team.id}/workspaces`, headers: auth,
    payload: { scope: { kind: 'organization', organizationId: team.id }, requestId: intent, name: 'Changed intent' } });
  expect(changed.statusCode).toBe(409); expect(changed.json().code).toBe('conflict');
});

it('keeps two identically named namespaces isolated across routes, bodies and cursors', async () => {
  const { server, org, workspace } = await setup();
  const a = await org('Same team', 'team-a'); const b = await org('Same team', 'team-b');
  const wa = await workspace(a.id); const wb = await workspace(b.id); await workspace(a.id, 'Second service');
  const read = await server.inject({ url: `/api/v2/organizations/${b.id}/workspaces/${wa.id}`, headers: auth });
  expect(read.statusCode).toBe(404);
  const write = await server.inject({ method: 'POST', url: `/api/v2/organizations/${a.id}/workspaces`, headers: auth,
    payload: { scope: { kind: 'organization', organizationId: b.id }, requestId: requestId(), name: 'Wrong route' } });
  expect(write.statusCode).toBe(404);
  const first = await server.inject({ url: `/api/v2/organizations/${a.id}/workspaces?limit=1`, headers: auth });
  expect(first.json().nextCursor).not.toBeNull();
  const reused = await server.inject({ url: `/api/v2/organizations/${b.id}/workspaces?limit=1&cursor=${first.json().nextCursor}`, headers: auth });
  expect(reused.statusCode).toBe(400);
  const own = await server.inject({ url: `/api/v2/organizations/${b.id}/workspaces?limit=100`, headers: auth });
  expect(own.json().items).toEqual([wb]);
});

it('moves folders with derived descendant paths and rejects stale versions/cycles', async () => {
  const { server, org, workspace, folder } = await setup();
  const owner = await org('Folder team', 'folder-team'); const project = await workspace(owner.id);
  const a = await folder(project, 'A'); const b = await folder(project, 'B'); const child = await folder(project, 'Child', a.id);
  const route = `/api/v2/organizations/${owner.id}/folders/${a.id}`;
  const move = { scope: a.scope, requestId: requestId(), expectedVersion: a.version, parentFolderId: b.id };
  expect((await server.inject({ method: 'PATCH', url: route, headers: auth, payload: move })).statusCode).toBe(200);
  const page = await server.inject({ url: `/api/v2/organizations/${owner.id}/workspaces/${project.id}/folders?limit=100`, headers: auth });
  expect(page.statusCode).toBe(200);
  expect((page.json().items as Folder[]).find(item => item.id === child.id)?.displayPath).toEqual(['Service', 'B', 'A', 'Child']);
  const stale = await server.inject({ method: 'PATCH', url: route, headers: auth,
    payload: { ...move, requestId: requestId(), name: 'Stale edit' } });
  expect(stale.statusCode).toBe(409);
  const cycle = await server.inject({ method: 'PATCH', url: `/api/v2/organizations/${owner.id}/folders/${b.id}`, headers: auth,
    payload: { scope: b.scope, requestId: requestId(), expectedVersion: b.version, parentFolderId: child.id } });
  expect(cycle.statusCode).toBe(422);
});

it('serves schema-valid URN identities through encoded routes without bare aliasing', async () => {
  const id = 'urn:uuid:abcdefab-cdef-4abc-8def-abcdefabcdef';
  let allocation = 50_000;
  const { server, org } = await setup(() => allocation++ === 50_000 ? id.toUpperCase() : uuid(allocation));
  const owner = await org('URN team', 'urn-team'); expect(owner.id).toBe(id);
  const response = await server.inject({ url: `/api/v2/organizations/${encodeURIComponent(id.toUpperCase())}`, headers: auth });
  expect(response.statusCode).toBe(200); expect(response.json()).toEqual(owner);
  const bare = await server.inject({ url: `/api/v2/organizations/${id.slice(9)}`, headers: auth });
  expect(bare.statusCode).toBe(404);
});

it('never publishes another scope when a broken reader mutates request authority', async () => {
  const foreign: Workspace = { id: uuid(200), version: 1, rootFolderId: uuid(201),
    name: 'SYNTHETIC_FOREIGN_WORKSPACE_CANARY', scope: { kind: 'organization', organizationId: uuid(99) } };
  const reader: NamespaceReader = {
    get: async key => { Reflect.set(key.scope, 'organizationId', foreign.scope.organizationId); return foreign; },
    list: async query => { Reflect.set(query.scope, 'organizationId', foreign.scope.organizationId); return { items: [foreign], nextCursor: null }; },
  };
  const { server } = await setup(undefined, reader);
  for (const url of [`/api/v2/organizations/${uuid(1)}/workspaces/${foreign.id}`,
    `/api/v2/organizations/${uuid(1)}/workspaces?limit=1`]) {
    const response = await server.inject({ url, headers: auth });
    expect(response.statusCode).toBe(404); expect(response.body).not.toContain(foreign.name);
  }
});

it('guards empty-only deletion and replays the exact response after the live namespace is gone',async()=>{
 const {server,org,workspace}=await setup();const owner=await org('Delete team','delete-team');const project=await workspace(owner.id);
 const url=`/api/v2/organizations/${owner.id}/workspaces/${project.id}`;
 const payload={scope:project.scope,requestId:requestId(),expectedVersion:project.version};
 expect((await server.inject({method:'DELETE',url,payload})).statusCode).toBe(401);
 expect((await server.inject({method:'DELETE',url,headers:auth,payload:{...payload,expectedVersion:2}})).statusCode).toBe(409);
 const first=await server.inject({method:'DELETE',url,headers:auth,payload});expect(first.statusCode).toBe(200);
 const replay=await server.inject({method:'DELETE',url,headers:auth,payload});expect(replay.json()).toEqual(first.json());
 expect((await server.inject({url,headers:auth})).statusCode).toBe(404);
 const removed=await server.inject({method:'DELETE',url:`/api/v2/organizations/${owner.id}`,headers:auth,
  payload:{scope:{kind:'installation'},requestId:requestId(),expectedVersion:owner.version}});
 expect(removed.statusCode).toBe(200);
});

it('recovers a committed DELETE after TCP reply loss and compiled-worker reopen',async()=>{
 const path=fixture.path();const first=await setup(undefined,undefined,path);let drop=false;let dropped=false;
 first.server.addHook('onSend',async(request,reply,payload)=>{
  if(drop&&request.method==='DELETE'){drop=false;dropped=true;reply.raw.destroy();}return payload;
 });
 const owner=await first.org('TCP delete','tcp-delete');const project=await first.workspace(owner.id);
 const route=`/api/v2/organizations/${owner.id}/workspaces/${project.id}`;
 const payload={scope:project.scope,requestId:requestId(),expectedVersion:project.version};
 const address=await first.server.listen({host:'127.0.0.1',port:0});drop=true;
 await expect(fetch(address+route,{method:'DELETE',headers:{...auth,'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(2000)})).rejects.toThrow();
 expect(dropped).toBe(true);await first.server.close();await fixture.close(first.metadata);
 const second=await setup(undefined,undefined,path);
 const replay=await second.server.inject({method:'DELETE',url:route,headers:auth,payload});expect(replay.statusCode).toBe(200);
 expect(replay.json()).toMatchObject({id:project.id,version:2,state:'tombstoned',cleanup:'complete',requestId:payload.requestId});
 expect((await second.metadata.inputs.storage()).chargedBytes).toBe(2048);
});
