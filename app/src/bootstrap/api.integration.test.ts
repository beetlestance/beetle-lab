import { afterEach, expect, it } from 'vitest';
import { createApiClient } from '@beetle/contracts/api';
import { openApplication } from './api.js';
import type { Application } from './api.js';
import { storageFixture, settingsFixture, observation, requestId } from '../../test/storage/fixture.js';
const fixture = storageFixture();
const applications: Application[] = [];
const externalOrigin = 'http://localhost:4310';
const baseHeaders = { host: 'localhost:4310', origin: externalOrigin };
afterEach(async () => { await Promise.all(applications.splice(0).map(application => application.close())); });
async function open(path = fixture.path(), runtime: 'known' | 'unknown' = 'known') {
  const settings = settingsFixture();
  const application = await openApplication({ externalOrigin, metadata: { path, workerUrl: fixture.workerUrl(),
    installation: settings.chain.installation, runtime: runtime === 'known' ? observation(settings.runtime) : null } });
  applications.push(application);
  return application;
}
async function pair(application: Application) {
  const result = await application.server.inject({ method: 'POST', url: '/api/v2/auth/pair',
    headers: { ...baseHeaders, 'x-beetle-pair': '1' }, payload: { bootstrapToken: application.bootstrapToken } });
  expect(result.statusCode).toBe(200);
  const cookie = String(result.headers['set-cookie']).split(';')[0]!;
  return { ...baseHeaders, cookie, 'x-beetle-csrf': result.json<{ csrfToken: string }>().csrfToken };
}
it('pairs a real session before namespace writes and reads durable SQLite through the same API', async () => {
  const application = await open();
  const denied = await application.server.inject({ url: '/api/v2/organizations?limit=100', headers: baseHeaders });
  expect(denied.statusCode).toBe(401);
  const headers = await pair(application);
  const body = { scope: { kind: 'installation' }, requestId: requestId(), name: 'Local team', slug: 'local-team' };
  const created = await application.server.inject({ method: 'POST', url: '/api/v2/organizations', headers, payload: body });
  expect(created.statusCode).toBe(201);
  const replay = await application.server.inject({ method: 'POST', url: '/api/v2/organizations', headers, payload: body });
  expect(replay.json()).toEqual(created.json());
  const page = await application.server.inject({ url: '/api/v2/organizations?limit=100', headers });
  expect(page.statusCode).toBe(200); expect(page.json().items).toEqual([created.json()]);
  const settings = await application.server.inject({ url: '/api/v2/settings', headers });
  expect(settings.statusCode).toBe(200);
  const forbidden = await application.server.inject({ method: 'POST', url: '/api/v2/organizations',
    headers: { ...headers, 'x-beetle-csrf': 'wrong' }, payload: { ...body, requestId: requestId(), slug: 'forbidden' } });
  expect(forbidden.statusCode).toBe(403);
  const logout = await application.server.inject({ method: 'POST', url: '/api/v2/auth/logout', headers, payload: {} });
  expect(logout.statusCode).toBe(200);
  expect((await application.server.inject({ url: '/api/v2/organizations?limit=100', headers })).statusCode).toBe(401);
});
it('retains namespace data across restart while invalidating the old browser session', async () => {
  const path = fixture.path(); const first = await open(path); const headers = await pair(first);
  const created = await first.server.inject({ method: 'POST', url: '/api/v2/organizations', headers,
    payload: { scope: { kind: 'installation' }, requestId: requestId(), name: 'Persisted', slug: 'persisted' } });
  expect(created.statusCode).toBe(201);
  const closing = first.close(); expect(first.close()).toBe(closing); await closing;
  const next = await open(path);
  expect((await next.server.inject({ url: '/api/v2/auth/session', headers })).statusCode).toBe(401);
  const fresh = await pair(next);
  const page = await next.server.inject({ url: '/api/v2/organizations?limit=100', headers: fresh });
  expect(page.json().items).toEqual([created.json()]);
});
it('reports unknown capacity rather than inventing host resources, and accepts trusted fresh observations', async () => {
  const application = await open(undefined, 'unknown'); const headers = await pair(application);
  expect((await application.server.inject({ url: '/api/v2/settings', headers })).statusCode).toBe(503);
  await application.updateRuntime(observation(settingsFixture().runtime));
  expect((await application.server.inject({ url: '/api/v2/settings', headers })).statusCode).toBe(200);
});
it('uses the shipped typed client through pairing, CSRF mutations and logout against the composed server', async () => {
  const application = await open();
  let cookie = '';
  const fetcher: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('host', 'localhost:4310'); headers.set('origin', externalOrigin);
    if (cookie) headers.set('cookie', cookie);
    const response = await application.server.inject({ method: init?.method as 'GET' | 'POST',
      url: new URL(String(input)).pathname + new URL(String(input)).search,
      headers: Object.fromEntries(headers), ...(typeof init?.body === 'string' ? { payload: init.body } : {}) });
    if (response.headers['set-cookie']) cookie = String(response.headers['set-cookie']).split(';')[0]!;
    return new Response(response.body, { status: response.statusCode, headers: { 'content-type': 'application/json' } });
  };
  const unpaired = createApiClient({ baseUrl: externalOrigin, fetch: fetcher, headers: { 'X-Beetle-Pair': '1' } });
  const grant = await unpaired.pairBrowserSession({ body: { bootstrapToken: application.bootstrapToken } });
  expect(grant.ok).toBe(true); if (!grant.ok) throw new Error('Pairing failed');
  const client = createApiClient({ baseUrl: externalOrigin, fetch: fetcher, headers: { 'X-Beetle-CSRF': grant.value.csrfToken } });
  const team = await client.createOrganization({ body: { scope: { kind: 'installation' },
    requestId: requestId(), name: 'Typed client team', slug: 'typed-client-team' } });
  expect(team.ok).toBe(true);
  expect((await client.listOrganizations({ query: { limit: 100 } })).ok).toBe(true);
  expect(await client.logoutBrowserSession({ body: {} })).toEqual({ ok: true, value: { loggedOut: true } });
  expect(await client.getBrowserSession()).toMatchObject({ ok: false, error: { status: 401 } });
});
