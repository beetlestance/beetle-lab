import { afterEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { validateApi } from '@beetle/contracts/api';
import { authPath, fixture, host, origin, organizationsPath, pairHeaders } from './test-fixture.js';
import { createLocalSession } from './index.js';

const servers: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.close())); });
function setup(beforeRoutes?: (server: FastifyInstance) => void) {
  const value = fixture({}, beforeRoutes); servers.push(value.server); return value;
}

it('denies Host then Origin then session then CSRF before parser, validation or real namespace store calls', async () => {
  const { server, paired, list, get, execute } = setup();
  const { headers } = await paired();
  const cases = [
    [{ ...headers, host: 'foreign.invalid', origin: 'http://foreign.invalid', cookie: '' }, 403],
    [{ ...headers, origin: 'http://foreign.invalid', cookie: '' }, 403],
    [{ ...headers, cookie: 'beetle_session=' }, 401],
    [{ ...headers, 'x-beetle-csrf': 'C'.repeat(43) }, 403],
    [{ ...headers, origin: '' }, 403],
    [{ ...headers, 'sec-fetch-site': 'cross-site' }, 403],
  ] as const;
  for (const [supplied, status] of cases) {
    for (const payload of ['{SECRET_CANARY', 'x'.repeat(1025)]) {
      const response = await server.inject({ method: 'POST', url: organizationsPath,
        headers: { ...supplied, 'content-type': 'application/json' }, payload });
      expect(response.statusCode).toBe(status); expect(response.headers['cache-control']).toBe('no-store');
      expect(validateApi('ApiError', response.json()).ok).toBe(true); expect(response.body).not.toContain('SECRET_CANARY');
    }
  }
  expect(list).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  expect((await server.inject({ url: organizationsPath, headers: { host } })).statusCode).toBe(401);
  const allowed = await server.inject({ url: `${organizationsPath}?limit=100`, headers: { host, cookie: headers.cookie } });
  expect(allowed.statusCode).toBe(200); expect(list).toHaveBeenCalledTimes(1);
  const invalidBody = await server.inject({ method: 'POST', url: organizationsPath,
    headers: { ...headers, 'content-type': 'application/json' }, payload: '{' });
  expect(invalidBody.statusCode).toBe(400); expect(execute).not.toHaveBeenCalled();
});

it('requires exact Host authority and exact present Origin, ignores forwarding headers and allows read-only HEAD', async () => {
  const { server, paired } = setup();
  const { headers } = await paired();
  for (const supplied of [
    { ...headers, host: '127.0.0.1' }, { ...headers, host: `${host}.` },
    { ...headers, host: `${host}@foreign.invalid` }, { ...headers, host: 'foreign.invalid', 'x-forwarded-host': host },
    { ...headers, origin: `${origin}/` }, { ...headers, origin: 'null' }, { ...headers, origin: `${origin}, ${origin}` },
  ]) expect((await server.inject({ url: organizationsPath, headers: supplied })).statusCode).toBe(403);
  const forwarded = await server.inject({ url: `${organizationsPath}?limit=100`,
    headers: { ...headers, 'x-forwarded-host': 'foreign.invalid', 'x-forwarded-proto': 'https', forwarded: 'host=foreign.invalid' } });
  expect(forwarded.statusCode).toBe(200);
  expect((await server.inject({ method: 'HEAD', url: `${organizationsPath}?limit=100`, headers: { host, cookie: headers.cookie } })).statusCode).toBe(200);
});

it('detects duplicate raw Host and Origin even when normalized headers contain only one value', async () => {
  for (const name of ['Host', 'Origin']) {
    const { server, pair, list } = setup();
    server.addHook('onRequest', async request => {
      // Model Node's normalized-single/raw-duplicate representation without a socket.
      request.raw.rawHeaders.push(name, name === 'Host' ? host : origin);
    });
    const response = await pair();
    expect(response.statusCode).toBe(403); expect(response.headers['set-cookie']).toBeUndefined();
    expect(list).not.toHaveBeenCalled();
  }
});

it('bounds raw header work and refuses malformed headers before pairing', async () => {
  for (const raw of [
    ['X-Fill', 'x'.repeat(16_384)], Array(129).fill(['X-Fill', 'x']).flat(),
    ['Invalid Name', 'x'], ['X-Fill', 'non-ascii-\u00e9'], ['X-Odd'],
  ]) {
    const { server, pair } = setup();
    server.addHook('onRequest', async request => { request.raw.rawHeaders.push(...raw); });
    const response = await pair();
    expect(response.statusCode).toBe(403); expect(response.headers['set-cookie']).toBeUndefined();
  }
});

it('rejects duplicate raw cookie and mutation CSRF headers despite normalized single values', async () => {
  for (const name of ['Cookie', 'X-Beetle-CSRF']) {
    const state: { duplicate?: string } = {};
    const { server, paired, execute } = setup(server => {
      server.addHook('onRequest', async request => {
        if (state.duplicate !== undefined) request.raw.rawHeaders.push(name, state.duplicate);
      });
    });
    const { headers } = await paired();
    state.duplicate = name === 'Cookie' ? headers.cookie : headers['x-beetle-csrf'];
    const response = await server.inject({ method: 'POST', url: organizationsPath,
      headers: { ...headers, 'content-type': 'application/json' }, payload: '{' });
    expect(response.statusCode, name).toBe(403); expect(execute).not.toHaveBeenCalled();
  }
});

it('rejects ambiguous, oversized or duplicate cookies and headers before protected reads', async () => {
  const { server, paired, list } = setup();
  const { headers, cookie } = await paired();
  for (const value of [`${cookie}; ${cookie}`, `${cookie}; beetle_session=`, `${cookie}; bad`,
    `${cookie}; quoted="bad"`, `${cookie}; other=${'x'.repeat(4096)}`, `${cookie}; ${Array(65).fill('a=b').join('; ')}`]) {
    const response = await server.inject({ url: organizationsPath, headers: { host, cookie: value } });
    expect(response.statusCode).toBe(403);
  }
  for (const value of ['beetle_session=x', 'beetle_session=' + 'Z'.repeat(43)]) {
    expect((await server.inject({ url: organizationsPath, headers: { host, cookie: value } })).statusCode).toBe(401);
  }
  expect(list).not.toHaveBeenCalled();
  expect((await server.inject({ url: `${organizationsPath}?limit=100`, headers: { ...headers, cookie: `other=ok; ${cookie}` } })).statusCode).toBe(200);
});

it('accepts canonical loopback IPv4/IPv6/localhost, root slash and HTTPS Secure cookies only', async () => {
  for (const externalOrigin of ['http://localhost:43127', 'http://127.0.0.2:43127', 'http://[::1]:43127', 'https://localhost:43127/']) {
    const { server, session } = fixture({ externalOrigin }); servers.push(server);
    const canonical = new URL(externalOrigin);
    const response = await server.inject({ method: 'POST', url: `${authPath}pair`,
      headers: { ...pairHeaders, host: canonical.host, origin: canonical.origin }, payload: { bootstrapToken: session.bootstrapToken } });
    expect(response.statusCode).toBe(200);
    expect(String(response.headers['set-cookie']).includes('; Secure')).toBe(canonical.protocol === 'https:');
    const headers = { host: canonical.host, origin: canonical.origin,
      cookie: String(response.headers['set-cookie']).split(';')[0]!, 'x-beetle-csrf': response.json().csrfToken };
    const logout = await server.inject({ method: 'POST', url: `${authPath}logout`, headers, payload: {} });
    expect(logout.statusCode).toBe(200);
    expect(String(logout.headers['set-cookie']).includes('; Secure')).toBe(canonical.protocol === 'https:');
  }
});

it('rejects non-loopback, URL credentials/paths/query/fragment and noncanonical aliases at construction', () => {
  for (const externalOrigin of ['http://foreign.invalid', 'http://0.0.0.0:43127', 'http://[::]:43127', 'ftp://localhost',
    'http://user:password@localhost:43127', `${origin}/path`, `${origin}/?query=secret`, `${origin}/#secret`,
    'http://LOCALHOST:43127', 'http://127.1:43127', 'http://localhost:80', 'https://localhost:443',
    'http://localhost.:43127', 'http://sub.localhost:43127', ' http://localhost:43127', 'http://localhost:043127']) {
    expect(() => createLocalSession({ externalOrigin })).toThrow('Canonical loopback external origin required');
  }
});
