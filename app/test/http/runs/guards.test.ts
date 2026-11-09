import { afterEach, expect, it } from 'vitest';
import { createApiServer } from '../../../src/adapters/inbound/http/api-errors.js';
import { registerRunRoutes } from '../../../src/adapters/inbound/http/runs/index.js';
import type { onRequestAsyncHookHandler } from 'fastify';
import { fixture, host, origin } from './fixture.js';

const fixtures: ReturnType<typeof fixture>[] = [];
function setup() { const value = fixture(); fixtures.push(value); return value; }
afterEach(async () => { await Promise.all(fixtures.splice(0).map(value => value.close())); });

it('requires the authorization function at route registration', async () => {
  const f = setup(); const server = createApiServer();
  try {
    expect(() => registerRunRoutes(server, { store: { execute: f.execute },
      reader: { getRun: f.getRun, listRuns: f.listRuns }, newId: f.newId, now: f.now,
      digest: () => 'a'.repeat(64), authorize: undefined as unknown as onRequestAsyncHookHandler })).toThrow();
  } finally { await server.close(); }
});

it('checks Host, Origin, session and CSRF before parsing, clock, allocation or store calls', async () => {
  const f = setup(); const headers = await f.paired();
  const denied = [
    { headers: { host, origin }, status: 401 },
    { headers: { ...headers, host: 'localhost:43127' }, status: 403 },
    { headers: { ...headers, origin: 'http://localhost:43127' }, status: 403 },
    { headers: { ...headers, origin: '' }, status: 403 },
    { headers: { ...headers, 'x-beetle-csrf': '' }, status: 403 },
  ];
  for (const value of denied) {
    const response = await f.server.inject({ method: 'POST', url: f.base,
      headers: { ...value.headers, 'content-type': 'application/json' }, payload: '{invalid' });
    expect(response.statusCode).toBe(value.status);
    expect(response.headers['cache-control']).toBe('no-store');
  }
  expect(f.newId).not.toHaveBeenCalled(); expect(f.now).not.toHaveBeenCalled();
  expect(f.execute).not.toHaveBeenCalled();
  expect((await f.server.inject({ url: `${f.base}?limit=1`, headers: { host } })).statusCode).toBe(401);
  expect((await f.server.inject({ url: `${f.base}/${f.body.revisionId}`, headers: { ...headers, host: 'wrong' } })).statusCode).toBe(403);
  expect(f.getRun).not.toHaveBeenCalled(); expect(f.listRuns).not.toHaveBeenCalled();
});

it('rejects route/body scope mismatch and strict/oversized bodies before allocations', async () => {
  const f = setup(); const headers = await f.paired();
  const foreign = { ...f.body, scope: { ...f.body.scope, workspaceId: f.body.revisionId } };
  const wrongScope = await f.server.inject({ method: 'POST', url: f.base, headers, payload: foreign });
  expect(wrongScope.statusCode).toBe(404);
  for (const extra of [{ config: {} }, { imageDigest: `sha256:${'a'.repeat(64)}` },
    { secrets: { token: 'synthetic' } }]) {
    expect((await f.server.inject({ method: 'POST', url: f.base, headers,
      payload: { ...f.body, ...extra } })).statusCode).toBe(400);
  }
  const oversized = await f.server.inject({ method: 'POST', url: f.base, headers,
    payload: { ...f.body, padding: 'x'.repeat(65536) } });
  expect(oversized.statusCode).toBe(413);
  expect(f.newId).not.toHaveBeenCalled(); expect(f.now).not.toHaveBeenCalled();
  expect(f.execute).not.toHaveBeenCalled();
});
