import { afterEach, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { LocalSessionRecord, LocalSessionStore } from '../../../../ports/local-session.js';
import { fixture, authPath, host, origin } from './test-fixture.js';
const servers: FastifyInstance[] = []; afterEach(async () => {await Promise.all(servers.splice(0).map(server => server.close()));});
const headers = {host, origin, 'content-type': 'application/json', 'x-beetle-local': '1'};
function memory(initial: LocalSessionRecord = {version: 0, session: null}) {
  let record = initial;
  const save = vi.fn<LocalSessionStore['save']>(async (expectedVersion, session) => {
    if (record.version === expectedVersion + 1 && JSON.stringify(record.session) === JSON.stringify(session)) return record;
    if (record.version !== expectedVersion) throw new Error('conflict');
    record = {version: expectedVersion + 1, session}; return record;
  });
  const store: LocalSessionStore = {load: async () => record, save}; return {store, save, value: () => record};
}
function setup(m = memory()) {const f = fixture({automatic: {initial: m.value(), store: m.store}}); servers.push(f.server); return {...f, m};}
async function grant(f: ReturnType<typeof setup>) {
  const response = await f.server.inject({method: 'POST', url: authPath + 'local', headers, payload: {}});
  const cookie = String(response.headers['set-cookie']).split(';')[0]!;
  return {response, cookie, view: response.json<{csrfToken: string; expiresAt: string; accessMode: string}>()};
}
it('opens directly, reuses a persisted cookie across restart without extending its lifetime, and requires CSRF for protected writes', async () => {
  const f = setup(); expect((await f.server.inject({url: authPath + 'session', headers: {host}})).statusCode).toBe(401);
  const g = await grant(f); expect(g.response.statusCode).toBe(200); expect(g.view.accessMode).toBe('automatic'); expect(f.m.save).toHaveBeenCalledTimes(1);
  expect(g.response.headers['cache-control']).toBe('no-store'); expect(g.response.headers['set-cookie']).toContain('HttpOnly; SameSite=Strict');
  expect((await grant(f)).cookie).toBe(g.cookie); expect(f.m.save).toHaveBeenCalledTimes(1);
  const next = setup(f.m); const read = await next.server.inject({url: authPath + 'session', headers: {host, cookie: g.cookie}});
  expect(read.statusCode).toBe(200); expect(read.json()).toEqual(g.view);
  const forbidden = await next.server.inject({method: 'POST', url: '/api/v2/organizations', headers: {host, origin, cookie: g.cookie}, payload: '{'});
  expect(forbidden.statusCode).toBe(403); expect(next.execute).not.toHaveBeenCalled();
  const logout = await next.server.inject({method: 'POST', url: authPath + 'logout', headers: {...headers, cookie: g.cookie, 'x-beetle-csrf': g.view.csrfToken}, payload: {}});
  expect(logout.statusCode).toBe(200); expect(f.m.value()).toEqual({version: 2, session: null});
  const revoked = setup(f.m); expect((await revoked.server.inject({url: authPath + 'session', headers: {host, cookie: g.cookie}})).statusCode).toBe(401);
  expect((await grant(revoked)).cookie).not.toBe(g.cookie);
});
it('rejects foreign, missing and duplicate protocol headers before malformed bodies or persistent effects', async () => {
  const f = setup();
  const denied: Record<string, string | string[]>[] = [{...headers, origin: 'http://evil.test'}, {...headers, host: 'evil.test'}, {...headers, origin: 'null'},
    {...headers, 'x-beetle-local': '2'}, {...headers, 'content-type': 'text/plain'}, {...headers, 'sec-fetch-site': 'cross-site'},
    {...headers, host: [host,host]}, {...headers, origin: [origin,origin]}, {host, 'x-beetle-local': '1', 'content-type': 'application/json'}];
  for (const bad of denied) {
    const result = await f.server.inject({method: 'POST', url: authPath + 'local', headers: bad, payload: '{'});
    expect(result.statusCode).toBe(403); expect(result.headers['access-control-allow-origin']).toBeUndefined();
  }
  expect((await f.server.inject({url: authPath + 'local', headers: {host}})).statusCode).toBe(404);
  expect((await f.server.inject({method: 'POST', url: authPath + 'local', headers, payload: {extra: true}})).statusCode).toBe(400);
  expect((await f.pair()).statusCode).toBe(403); expect(f.m.save).not.toHaveBeenCalled();
});
it('retains and reconciles the same grant after a lost persistence reply, fencing protected reads while unknown', async () => {
  const f = setup(); const save = f.m.save.getMockImplementation()!;
  f.m.save.mockImplementationOnce(async (...args) => {await save(...args); throw new Error('lost reply');});
  const lost = await grant(f); expect(lost.response.statusCode).toBe(500); expect(lost.response.headers['set-cookie']).toBeUndefined();
  const saved = f.m.value(); const blocked = await f.server.inject({url: authPath + 'session', headers: {host, cookie: `beetle_session=${saved.session!.cookie}`}});
  expect(blocked.statusCode).toBe(503);
  const recovered = await grant(f); expect(recovered.response.statusCode).toBe(200); expect(f.m.value()).toEqual(saved);
  expect(f.m.save.mock.calls[1]).toEqual(f.m.save.mock.calls[0]);
});
it('reconciles unknown logout before acknowledging it and fences new reads until then', async () => {
  const f = setup(); const g = await grant(f); const save = f.m.save.getMockImplementation()!;
  f.m.save.mockImplementationOnce(async (...args) => {await save(...args); throw new Error('lost reply');});
  const logout = () => f.server.inject({method: 'POST', url: authPath + 'logout', headers: {...headers, cookie: g.cookie, 'x-beetle-csrf': g.view.csrfToken}, payload: {}});
  expect((await logout()).statusCode).toBe(500);
  expect((await f.server.inject({url: authPath + 'session', headers: {host, cookie: g.cookie}})).statusCode).toBe(503);
  expect((await logout()).statusCode).toBe(200); expect(f.m.value()).toEqual({version: 2, session: null});
  expect(f.m.save.mock.calls[2]).toEqual(f.m.save.mock.calls[1]);
});
it('restores only remaining lifetime and renews an expired credential without a restart', async () => {
  const f = setup(); const g = await grant(f); const time = {monotonic: 100, wall: f.time.wall + 2 * 60 * 60_000};
  const next = fixture({automatic: {initial: f.m.value(), store: f.m.store}, clocks: {
    monotonicNow: () => time.monotonic, wallNow: () => time.wall}}); servers.push(next.server);
  const read = () => next.server.inject({url: authPath + 'session', headers: {host, cookie: g.cookie}});
  time.monotonic += 6 * 60 * 60_000 - 1; time.wall += 6 * 60 * 60_000 - 1;
  expect((await read()).statusCode).toBe(200); time.monotonic++; time.wall++;
  expect((await read()).statusCode).toBe(401);
  const renewed = await next.server.inject({method: 'POST', url: authPath + 'local', headers, payload: {}});
  expect(renewed.statusCode).toBe(200); expect(String(renewed.headers['set-cookie']).split(';')[0]).not.toBe(g.cookie);
  expect(f.m.value().version).toBe(2);
});
it('bounds concurrent credential writes and denies late publication after close', async () => {
  const f = setup(); let finish!: () => void; const held = new Promise<void>(resolve => {finish = resolve;});
  const save = f.m.save.getMockImplementation()!; f.m.save.mockImplementationOnce(async (...args) => {await held; return save(...args);});
  const pending = grant(f); await vi.waitFor(() => expect(f.m.save).toHaveBeenCalledTimes(1));
  expect((await grant(f)).response.statusCode).toBe(429); expect(f.m.save).toHaveBeenCalledTimes(1);
  f.session.close(); finish(); const closed = await pending;
  expect(closed.response.statusCode).toBe(503); expect(closed.response.headers['set-cookie']).toBeUndefined();
});
it.each(['grant','logout'] as const)('denies %s publication when close runs between the final owner check and HTTP continuation', async phase => {
  const m = memory(); const save = m.save.getMockImplementation()!; let armed = false; let reads = 0; let close = () => {};
  m.save.mockImplementation(async (...args) => {const result = await save(...args); if ((phase === 'grant') === (args[1] !== null)) {armed = true; reads = 0;} return result;});
  const f = fixture({automatic: {initial: m.value(), store: m.store}, clocks: {
    monotonicNow: () => {if (armed && ++reads === (phase === 'grant' ? 2 : 1)) queueMicrotask(close); return 1000;}, wallNow: () => Date.UTC(2026, 0, 1)}});
  servers.push(f.server); close = () => f.session.close();
  const response = await f.server.inject({method: 'POST', url: authPath + 'local', headers, payload: {}});
  if (phase === 'grant') {expect(response.statusCode).toBe(503); expect(response.headers['set-cookie']).toBeUndefined(); return;}
  expect(response.statusCode).toBe(200);
  const cookie = String(response.headers['set-cookie']).split(';')[0]!;
  const logout = await f.server.inject({method: 'POST', url: authPath + 'logout', headers: {...headers, cookie, 'x-beetle-csrf': response.json().csrfToken as string}, payload: {}});
  expect(logout.statusCode).toBe(503); expect(logout.headers['set-cookie']).toBeUndefined();
});
