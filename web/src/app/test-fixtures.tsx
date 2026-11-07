import { createApiClient } from '@beetle/contracts/api';
import type { ApiError, Folder, Organization, Workspace } from '@beetle/contracts/api';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { render } from '@testing-library/react';
import { App } from './App.js';
import { routes } from './routes.js';

export const ids = {
  a: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  b: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  workspace: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  root: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  folder: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  parent: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  request: '12345678-1234-4234-8234-123456789012',
};
export function org(id = ids.a): Organization {
  return { id, version: 1, scope: { kind: 'installation' }, name: 'Same organization', slug: id === ids.a ? 'one' : 'two' };
}
export function workspace(organizationId = ids.a): Workspace {
  return { id: ids.workspace, version: 3, scope: { kind: 'organization', organizationId }, name: 'Same workspace', rootFolderId: ids.root };
}
export function folder(organizationId = ids.a): Folder {
  return { id: ids.folder, version: 7, scope: { kind: 'workspace', organizationId, workspaceId: ids.workspace },
    name: 'Same folder', parentFolderId: ids.root, displayPath: ['Services', 'Same folder'] };
}
export function apiError(code: ApiError['code']): ApiError {
  const messages: Partial<Record<ApiError['code'], ApiError['message']>> = {
    conflict: 'Version or intent conflict', unpaired: 'Pairing required', invalid_value: 'Invalid value', storage_unavailable: 'Storage unavailable',
  };
  return { code, message: messages[code] ?? 'Internal error', requestId: ids.request, retryable: false, fields: [] };
}
export function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}
export interface RequestRecord { path: string; method: string; body: Record<string, unknown> | undefined; signal: AbortSignal | undefined }
export function testClient(handler: (request: RequestRecord) => Response | Promise<Response>) {
  const records: RequestRecord[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const record = { path: url.pathname + url.search, method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined,
      signal: init?.signal ?? undefined };
    records.push(record);
    if (records.length > 100) throw new Error('Synthetic request budget exceeded');
    return handler(record);
  };
  return { client: createApiClient({ baseUrl: 'http://localhost', fetch: fetcher }), records };
}
export function readNamespace(request: RequestRecord): Response {
  if (request.path === '/api/v2/organizations?limit=100') return json({ scope: { kind: 'installation' }, items: [org(), org(ids.b)], nextCursor: null });
  const organizationId = request.path.includes(ids.b) ? ids.b : ids.a;
  if (request.path.endsWith(`/organizations/${organizationId}`)) return json(org(organizationId));
  if (request.path.endsWith(`/workspaces/${ids.workspace}`)) return json(workspace(organizationId));
  if (request.path.includes('/folders?')) return json({ scope: folder(organizationId).scope, items: [folder(organizationId)], nextCursor: null });
  if (request.path.includes('/workspaces?')) return json({ scope: workspace(organizationId).scope, items: [workspace(organizationId)], nextCursor: null });
  throw new Error('Unexpected synthetic route');
}
function NavigationDriver() {
  const navigate = useNavigate();
  return <div><button onClick={() => void navigate(routes.organization(ids.b))}>Switch organization B</button>
    <button onClick={() => void navigate(routes.organization(ids.a))}>Switch organization A</button>
    <button onClick={() => void navigate(routes.workspace(ids.b, ids.workspace))}>Switch workspace B</button>
    <button onClick={() => void navigate(routes.workspace(ids.a, ids.workspace))}>Switch workspace A</button></div>;
}
export function mount(client: ReturnType<typeof testClient>['client'], initial = '/') {
  return render(<MemoryRouter initialEntries={[initial]}><NavigationDriver /><App apiClient={client} /></MemoryRouter>);
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
