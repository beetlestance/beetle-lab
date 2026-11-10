import { afterEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { createApiClient, validateApi } from '@beetle/contracts/api';
import type { BrowserSession } from '@beetle/contracts/api';
import { openApplication } from '../../src/bootstrap/api.js';
import type { Application } from '../../src/bootstrap/api.js';
import { getResult } from '../../src/adapters/inbound/http/runs/result.js';
import { storageFixture, settingsFixture } from '../storage/fixture.js';
import { fixture as oldRouteFixture } from '../http/runs/fixture.js';
import { fixture, keyFor, largeFixture, scope, uuid } from './fixture.js';

const storage = storageFixture(); const applications = new Set<Application>();
afterEach(async () => { await Promise.all([...applications].map(app => app.close())); applications.clear(); });
async function ownedOrigin(): Promise<string> {
  const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const address = listener.address();
  try {
    if (!address || typeof address === 'string') throw new Error('Synthetic listener unavailable');
    return `http://127.0.0.1:${address.port}`;
  } finally {
    await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  }
}
async function application(path: string) {
  const origin = await ownedOrigin(); const host = new URL(origin).host;
  const app = await openApplication({ externalOrigin: origin, metadata: { path, workerUrl: storage.workerUrl(),
    installation: settingsFixture().chain.installation, runtime: null } });
  applications.add(app);
  await app.server.listen({ host: '127.0.0.1', port: Number(new URL(origin).port) });
  const address = app.server.server.address();
  if (!address || typeof address === 'string') throw new Error('Synthetic listener unavailable');
  const base = `http://127.0.0.1:${address.port}`;
  let requests = 0;
  const request = async (path: string, init?: RequestInit): Promise<Response> => {
    if (++requests > 24 || !path.startsWith('/api/v2/')) throw new Error('Synthetic request bound');
    const headers = new Headers({ host, origin });
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    return fetch(base + path, { ...init, headers, redirect: 'error' });
  };
  const pair = await request('/api/v2/auth/pair', { method: 'POST', headers: {
    'content-type': 'application/json', 'x-beetle-pair': '1' }, body: JSON.stringify({ bootstrapToken: app.bootstrapToken }) });
  expect(pair.status).toBe(200);
  const session = await pair.json() as BrowserSession;
  const cookie = pair.headers.get('set-cookie')!.split(';')[0]!;
  const headers = { cookie, 'x-beetle-csrf': session.csrfToken };
  const api = createApiClient({ baseUrl: origin, fetch: async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== origin) throw new Error('Synthetic origin boundary');
    return request(url.pathname + url.search, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), ...headers } });
  } });
  return { app, request, headers, api };
}

it('serves a provisional verified large result over authorized real HTTP and compiled metadata, without terminal/refund effects', async () => {
  const f = largeFixture();
  f.outputs.execute({ kind: 'outputAdopt', request: { binding: f.binding, envelope: f.envelope } });
  const before = f.facts(); const path = storage.path(); f.db.prepare('VACUUM INTO ?').run(path);
  const { app, request, headers, api } = await application(path);
  const params = { organizationId: scope.organizationId, workspaceId: scope.workspaceId, runId: f.key.runId };
  const route = `/api/v2/organizations/${params.organizationId}/workspaces/${params.workspaceId}/runs/${params.runId}/result`;
  expect((await request(route)).status).toBe(401);
  expect((await request(route, { headers: { ...headers, origin: 'http://127.0.0.1:1' } })).status).toBe(403);
  expect((await request(route.replace(params.runId, 'invalid-uuid'), { headers })).status).toBe(400);
  expect((await request(route.replace(params.workspaceId, uuid(999)), { headers })).status).toBe(404);
  const response = await request(route, { headers });
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(Buffer.byteLength(text)).toBeGreaterThan(65536);
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(73728);
  const view: unknown = JSON.parse(text);
  expect(validateApi('RunResultSnapshot', view).ok).toBe(true);
  expect(view).toEqual({ id: f.key.runId, scope, activeAttemptId: f.key.attempt.attemptId, result: f.envelope.manifest.result });
  expect(await api.getRunResult({ params })).toEqual({ ok: true, value: view });
  expect(await api.getRun({ params })).toMatchObject({ ok: true, value: { outcome: 'pending', validationStatus: 'pending' } });
  await app.close(); applications.delete(app);
  const db = new DatabaseSync(path);
  try {
    const after = ['execution_records', 'execution_output_payloads', 'event_cursors', 'run_events', 'attempts', 'dispatch_outbox',
      'runs', 'attempt_output_allocations', 'installation_storage_usage'].map(table => db.prepare(`SELECT * FROM ${table}`).all());
    expect(after).toEqual(before);
  } finally { db.close(); }
});

it('returns authorized pending/null for a queued run from production bootstrap', async () => {
  const f = fixture(); const queued = f.add(74); const path = storage.path(); f.db.prepare('VACUUM INTO ?').run(path);
  const { api } = await application(path);
  expect(await api.getRunResult({ params: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, runId: queued.runId } }))
    .toEqual({ ok: true, value: { id: queued.runId, scope, activeAttemptId: queued.attempt.attemptId, result: null } });
});

it('returns explicit 503 for a subset route factory with no result capability', async () => {
  const f = oldRouteFixture();
  try {
    const headers = await f.paired();
    const reply = await f.server.inject({ method: 'GET', url: `${f.base}/${uuid(7)}/result`, headers });
    expect(reply.statusCode).toBe(503); expect(reply.json()).toMatchObject({ code: 'storage_unavailable' });
  } finally { await f.close(); }
});

it('rejects oversized/schema-invalid/misbound replies before HTTP serialization', async () => {
  const f = fixture(); const key = keyFor(f.key.runId);
  const good = { id: key.id, scope, activeAttemptId: f.key.attempt.attemptId, result: null };
  const wrong = { ...good, id: uuid(999) };
  await expect(getResult(key, { getRunResult: async () => wrong })).rejects.toMatchObject({ code: 'not_found' });
  const misbound = validateApi('RunResultSnapshot', { ...good, result: { ...f.envelope.manifest.result, attemptId: uuid(999) } });
  if (!misbound.ok) throw new Error('Malformed synthetic response fixture');
  for (const reply of [{ ...good, padding: 'x'.repeat(73728) }, { ...good, privateJournal: 'secret' },
    misbound.value]) {
    await expect(getResult(key, { getRunResult: async () => reply })).rejects.toThrow('Response does not satisfy its contract');
  }
});
