import { afterEach, expect, it } from 'vitest';
import type { Application } from '../../../bootstrap/api.js';
import { openApplication } from '../../../bootstrap/api.js';
import type { BrowserSession, Suite, SuiteRevision, Workspace } from '@beetle/contracts/api';
import { storageFixture, settingsFixture, requestId } from '../../../../test/storage/fixture.js';
import { largeConfig, request } from '../../../../test/storage/suites-fixture.js';

const fixture = storageFixture();
const apps: Application[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
const host = '127.0.0.1:43127'; const origin = `http://${host}`;
async function setup(path = fixture.path()) {
  const app = await openApplication({ externalOrigin: origin, metadata: { path, workerUrl: fixture.workerUrl(),
    installation: settingsFixture().chain.installation, runtime: null } }); apps.push(app);
  const pair = await app.server.inject({ method: 'POST', url: '/api/v2/auth/pair',
    headers: { host, origin, 'x-beetle-pair': '1' }, payload: { bootstrapToken: app.bootstrapToken } });
  expect(pair.statusCode).toBe(200);
  const headers = { host, origin, cookie: String(pair.headers['set-cookie']).split(';')[0]!,
    'x-beetle-csrf': pair.json<BrowserSession>().csrfToken };
  return { app, headers, path };
}
it('saves and replays full size configuration through real pairing/CSRF/SQLite and reload', async () => {
  const { app, headers, path } = await setup(); const server = app.server;
  const organization = await server.inject({ method: 'POST', url: '/api/v2/organizations', headers,
    payload: { scope: { kind: 'installation' }, requestId: requestId(), name: 'Team', slug: 'team' } });
  expect(organization.statusCode).toBe(201);
  const organizationId = organization.json<{ id: string }>().id;
  const workspace = await server.inject({ method: 'POST', url: `/api/v2/organizations/${organizationId}/workspaces`, headers,
    payload: { scope: { kind: 'organization', organizationId }, requestId: requestId(), name: 'Project' } });
  expect(workspace.statusCode).toBe(201); const workspaceId = workspace.json<Workspace>().id;
  const scope = { kind: 'workspace' as const, organizationId, workspaceId };
  const base = `/api/v2/organizations/${organizationId}/workspaces/${workspaceId}`;
  const body = { scope, requestId: requestId(), name: 'Suite' };
  expect((await server.inject({ method: 'POST', url: `${base}/suites`, headers: { host, origin }, payload: body })).statusCode).toBe(401);
  expect((await server.inject({ method: 'POST', url: `${base}/suites`, headers: { ...headers, 'x-beetle-csrf': '' }, payload: body })).statusCode).toBe(403);
  const created = await server.inject({ method: 'POST', url: `${base}/suites`, headers, payload: body });
  expect(created.statusCode).toBe(201); const suite = created.json<Suite>();
  const payload = { ...request(), scope, config: largeConfig() };
  const url = `${base}/suites/${suite.id}/revisions`;
  const saved = await server.inject({ method: 'POST', url, headers, payload });
  expect(saved.statusCode, saved.body.slice(0, 500)).toBe(201); const revision = saved.json<SuiteRevision>();
  const detail = await server.inject({ url: `${base}/revisions/${revision.id}`, headers });
  expect(detail.statusCode).toBe(200); expect(detail.json()).toEqual(revision);
  const replay = await server.inject({ method: 'POST', url, headers, payload });
  expect(replay.statusCode).toBe(201); expect(replay.json()).toEqual(revision);
  const list = await server.inject({ url: `${url}?limit=100`, headers });
  expect(list.statusCode).toBe(200); expect(list.json().items[0]).not.toHaveProperty('config');
  const patch = await server.inject({ method: 'PATCH', url: `${base}/suites/${suite.id}`, headers,
    payload: { scope, requestId: requestId(), expectedVersion: 2, name: 'Renamed' } });
  expect(patch.statusCode).toBe(200);
  expect((await server.inject({ url: `${base}/suites?limit=100`, headers })).json().items[0].name).toBe('Renamed');
  const wrong = await server.inject({ method: 'POST', url: `${base}/suites`, headers,
    payload: { ...body, scope: { ...scope, workspaceId: suite.id }, requestId: requestId() } });
  expect(wrong.statusCode).toBe(404);
  await app.close(); apps.splice(apps.indexOf(app), 1);
  const reopened = await setup(path);
  const read = await reopened.app.server.inject({ url: `${base}/revisions/${revision.id}`, headers: reopened.headers });
  expect(read.statusCode).toBe(200); expect(read.json()).toEqual(revision);
  const settings = await reopened.app.server.inject({ url: '/api/v2/settings', headers: reopened.headers });
  // Runtime unavailability must not stop authoring or namespace reads.
  expect((await reopened.app.server.inject({ url: `${base}/suites/${suite.id}`, headers: reopened.headers })).statusCode).toBe(200);
  expect(settings.statusCode).toBe(503); expect(settings.json().code).toBe('capacity_unavailable');
  expect((await reopened.app.server.inject({ url: `/api/v2/organizations/${organizationId}/workspaces/${workspaceId}`, headers: reopened.headers })).statusCode).toBe(200);
});
