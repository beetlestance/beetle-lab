import { afterEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { createApiClient } from '@beetle/contracts/api';
import type { BrowserSession } from '@beetle/contracts/api';
import { openApplication } from '../../src/bootstrap/api.js';
import type { Application } from '../../src/bootstrap/api.js';
import { storageFixture, settingsFixture } from '../storage/fixture.js';
import { fixture, request as ingest, scope, uuid } from './fixture.js';
import { fixture as routes } from '../http/runs/fixture.js';
const storage = storageFixture(); const handles = new Set<Application>();
afterEach(async () => { await Promise.all([...handles].map(app => app.close())); handles.clear(); });
async function application(path: string) {
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('Synthetic port missing');
  const origin = `http://127.0.0.1:${address.port}`;
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  const app = await openApplication({ externalOrigin: origin, metadata: { path, workerUrl: storage.workerUrl(),
    installation: settingsFixture().chain.installation, runtime: null } });
  handles.add(app); await app.server.listen({ host: '127.0.0.1', port: address.port });
  let calls = 0;
  const request = (route: string, init?: RequestInit) => {
    if (++calls > 24 || !route.startsWith('/api/v2/')) throw new Error('Synthetic request bound');
    return fetch(origin + route, { ...init, redirect: 'error', headers: { origin, ...Object.fromEntries(new Headers(init?.headers)) } });
  };
  const pair = await request('/api/v2/auth/pair', { method: 'POST', headers: { 'content-type': 'application/json', 'x-beetle-pair': '1' },
    body: JSON.stringify({ bootstrapToken: app.bootstrapToken }) });
  expect(pair.status).toBe(200); const session = await pair.json() as BrowserSession;
  const headers = { cookie: pair.headers.get('set-cookie')!.split(';')[0]!, 'x-beetle-csrf': session.csrfToken };
  const api = createApiClient({ baseUrl: origin, fetch: async (input, init) => {
    const url = new URL(String(input)); if (url.origin !== origin) throw new Error('Synthetic origin boundary');
    return request(url.pathname + url.search, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), ...headers } });
  } });
  return { app, request, headers, api };
}
it('reads real metadata ingestion over authenticated TCP, resumes and reopens without changing accounting or ACK', async () => {
  const f = fixture(); const path = storage.path(); f.db.prepare('VACUUM INTO ?').run(path);
  const metadata = await storage.open(path, { runs: f.config });
  await metadata.events.ingest(ingest(f.binding, 0, 3));
  const first = await metadata.runEvents.getRunEvents({ ...f.query, limit: 1 });
  await expect(metadata.runEvents.getRunEvents({ ...f.query, cursor: '!' })).rejects.toMatchObject({ code: 'invalid_input' });
  const one = metadata.runEvents.getRunEvents(f.query); const two = metadata.runEvents.getRunEvents(f.query);
  await expect(metadata.runEvents.getRunEvents(f.query)).rejects.toMatchObject({ code: 'queue_full' });
  await Promise.all([one, two]);
  await storage.close(metadata);
  const db = new DatabaseSync(path);
  const tables = ['event_cursors', 'run_events', 'runs', 'attempt_output_allocations', 'installation_storage_usage', 'execution_records'];
  const before = tables.map(table => db.prepare(`SELECT * FROM ${table}`).all()); db.close();
  const { app, request, headers, api } = await application(path);
  const params = { organizationId: scope.organizationId, workspaceId: scope.workspaceId, runId: f.key.runId };
  const route = `/api/v2/organizations/${params.organizationId}/workspaces/${params.workspaceId}/runs/${params.runId}/events?limit=1`;
  expect((await request(route)).status).toBe(401);
  expect((await request(route, { headers: { ...headers, origin: 'http://127.0.0.1:1' } })).status).toBe(403);
  expect((await request(route.replace(params.workspaceId, uuid(999)), { headers })).status).toBe(404);
  expect((await request(route.replace('limit=1', 'limit=101'), { headers })).status).toBe(400);
  expect(await api.listRunEvents({ params, query: { limit: 1 } })).toEqual({ ok: true, value: first });
  const second = await api.listRunEvents({ params, query: { limit: 100, cursor: first.resumeCursor } });
  expect(second).toMatchObject({ ok: true, value: { afterSeq: 1, durableThrough: 3, nextCursor: null, items: [{ seq: 2 }, { seq: 3 }] } });
  if (!second.ok) throw new Error('Missing event page');
  expect(await api.listRunEvents({ params, query: { limit: 100, cursor: second.value.resumeCursor } }))
    .toMatchObject({ ok: true, value: { afterSeq: 3, items: [] } });
  await app.close(); handles.delete(app);
  const reopened = await application(path);
  expect(await reopened.api.listRunEvents({ params, query: { limit: 1 } })).toEqual({ ok: true, value: first });
  await reopened.app.close(); handles.delete(reopened.app);
  const check = new DatabaseSync(path);
  try { expect(tables.map(table => check.prepare(`SELECT * FROM ${table}`).all())).toEqual(before); }
  finally { check.close(); }
});
it('reports missing reusable route reader as unavailable', async () => {
  const f = routes();
  try {
    const headers = await f.paired();
    expect((await f.server.inject({ method: 'GET', url: `${f.base}/${uuid(7)}/events?limit=1`, headers })).statusCode).toBe(503);
  } finally { await f.close(); }
});
