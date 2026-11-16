import { afterEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { validateApi } from '@beetle/contracts/api';
import { authPath, fixture, host, origin, pairHeaders, organizationsPath } from './test-fixture.js';

const servers: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.close())); });
function setup() { const value = fixture(); servers.push(value.server); return value; }

it('pairs, recovers on reload, authorizes a real namespace route, and revokes on logout', async () => {
  const { server, session, paired, list, pair } = setup();
  const { response, view, cookie, headers } = await paired();
  expect(response.statusCode).toBe(200); expect(validateApi('BrowserSession', view).ok).toBe(true);
  expect(Object.keys(view).sort()).toEqual(['csrfToken', 'expiresAt', 'scope']);
  expect(response.headers['cache-control']).toBe('no-store');
  const setCookie = String(response.headers['set-cookie']);
  expect(setCookie).toMatch(/^beetle_session=[A-Za-z0-9_-]{43}; Path=\/api\/v2\/; HttpOnly; SameSite=Strict; Max-Age=28800$/);
  expect(setCookie).not.toContain(view.csrfToken); expect(response.body).not.toContain(cookie.slice('beetle_session='.length));
  expect(response.body).not.toContain(session.bootstrapToken);
  const recovered = await server.inject({ url: `${authPath}session`, headers: { host, cookie, 'sec-fetch-site': 'none' } });
  expect(recovered.statusCode).toBe(200); expect(recovered.json()).toEqual(view);
  expect(recovered.headers['cache-control']).toBe('no-store');
  const read = await server.inject({ url: `${organizationsPath}?limit=100`, headers });
  expect(read.statusCode).toBe(200); expect(list).toHaveBeenCalledTimes(1);
  const logout = await server.inject({ method: 'POST', url: `${authPath}logout`, headers, payload: {} });
  expect(logout.statusCode).toBe(200); expect(logout.json()).toEqual({ loggedOut: true });
  expect(logout.headers['cache-control']).toBe('no-store');
  expect(validateApi('LogoutBrowserReceipt', logout.json()).ok).toBe(true);
  expect(logout.headers['set-cookie']).toBe('beetle_session=; Path=/api/v2/; HttpOnly; SameSite=Strict; Max-Age=0');
  expect((await server.inject({ url: `${authPath}session`, headers })).statusCode).toBe(401);
  expect((await server.inject({ method: 'POST', url: `${authPath}logout`, headers, payload: {} })).statusCode).toBe(401);
  expect((await pair()).statusCode).toBe(401);
});

it('atomically consumes once for simultaneous requests; invalid and replayed tokens are indistinguishable', async () => {
  const { pair, session } = setup();
  const invalid = await pair('A'.repeat(43));
  const results = await Promise.all([pair(), pair()]);
  expect(results.map(result => result.statusCode).sort()).toEqual([200, 401]);
  for (const response of [invalid, results.find(result => result.statusCode === 401)!, await pair()]) {
    expect(response.statusCode).toBe(401); expect(response.json()).toMatchObject({ code: 'unpaired', message: 'Pairing required' });
    expect(validateApi('ApiError', response.json()).ok).toBe(true);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).not.toContain(session.bootstrapToken); expect(response.headers['set-cookie']).toBeUndefined();
  }
});

it('uses shipped strict request validation and safe no-store parser/body-limit errors', async () => {
  const { server, session, paired } = setup();
  for (const payload of [{ bootstrapToken: session.bootstrapToken, extra: 'SECRET_CANARY' }, { bootstrapToken: 12 }, {}]) {
    const response = await server.inject({ method: 'POST', url: `${authPath}pair`, headers: pairHeaders, payload });
    expect(response.statusCode).toBe(400); expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).not.toContain('SECRET_CANARY');
  }
  const malformed = await server.inject({ method: 'POST', url: `${authPath}pair`, headers: pairHeaders, payload: '{SECRET_CANARY' });
  expect(malformed.statusCode).toBe(400); expect(malformed.headers['cache-control']).toBe('no-store');
  const { headers } = await paired();
  for (const [payload, status] of [['{SECRET_CANARY', 400], ['x'.repeat(1025), 413], [{ extra: 'SECRET_CANARY' }, 400]] as const) {
    const response = await server.inject({ method: 'POST', url: `${authPath}logout`, headers: { ...headers, 'content-type': 'application/json' }, payload });
    expect(response.statusCode).toBe(status); expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).not.toContain('SECRET_CANARY'); expect(validateApi('ApiError', response.json()).ok).toBe(true);
  }
});

it('bounds global pair attempts before parsing, resets the fixed window, and skips origin denials', async () => {
  const { server, time, pair } = setup();
  for (let i = 0; i < 8; i++) {
    const foreign = await server.inject({ method: 'POST', url: `${authPath}pair`, headers: { ...pairHeaders, origin: 'http://foreign.invalid' }, payload: '{' });
    expect(foreign.statusCode).toBe(403);
  }
  for (let i = 0; i < 5; i++) expect((await pair('B'.repeat(43))).statusCode).toBe(401);
  const denied = await server.inject({ method: 'POST', url: `${authPath}pair`, headers: pairHeaders, payload: 'x'.repeat(1025) });
  expect(denied.statusCode).toBe(429); expect(denied.json().code).toBe('rate_limited');
  expect(denied.headers['cache-control']).toBe('no-store');
  time.monotonic += 59_999; expect((await pair()).statusCode).toBe(429);
  time.monotonic += 1; expect((await pair()).statusCode).toBe(200);
});

it('refuses missing pairing protocol headers and never grants CORS or unsupported method effects', async () => {
  const { server, list, execute } = setup();
  for (const headers of [{ host, origin }, { ...pairHeaders, 'x-beetle-pair': '2' },
    { ...pairHeaders, 'content-type': 'text/plain' }, { ...pairHeaders, origin: 'null' }]) {
    const response = await server.inject({ method: 'POST', url: `${authPath}pair`, headers, payload: '{' });
    expect(response.statusCode).toBe(403); expect(response.headers['access-control-allow-origin']).toBeUndefined();
  }
  const options = await server.inject({ method: 'OPTIONS', url: `${authPath}pair`, headers: { host, origin } });
  expect(options.statusCode).toBe(404); expect(options.headers['access-control-allow-origin']).toBeUndefined();
  expect(list).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
});
