import { afterEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createLocalSession } from './index.js';
import { authPath, fixture, host, origin, pairHeaders } from './test-fixture.js';

const servers: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.close())); });
function setup() { const value = fixture(); servers.push(value.server); return value; }

it('expires bootstrap at the absolute deadline and cannot renew without a restart', async () => {
  const { time, pair } = setup();
  time.monotonic += 15 * 60_000;
  const expired = await pair();
  expect(expired.statusCode).toBe(401); expect(expired.json().code).toBe('unpaired');
  time.monotonic += 60_000;
  expect((await pair()).statusCode).toBe(401);
  const replacement = setup(); expect((await replacement.pair()).statusCode).toBe(200);
});

it('expires sessions at eight hours despite reads and wall-clock jumps; restart rejects old cookies', async () => {
  const { server, time, paired, pair } = setup();
  const { headers, view } = await paired();
  time.wall -= 30 * 24 * 60 * 60_000;
  time.monotonic += 4 * 60 * 60_000;
  const early = await server.inject({ url: `${authPath}session`, headers });
  expect(early.statusCode).toBe(200); expect(early.json()).toEqual(view);
  time.wall += 365 * 24 * 60 * 60_000;
  time.monotonic += 4 * 60 * 60_000 - 1;
  expect((await server.inject({ url: `${authPath}session`, headers })).statusCode).toBe(200);
  time.monotonic += 1;
  expect((await server.inject({ url: `${authPath}session`, headers })).statusCode).toBe(401);
  expect((await pair()).statusCode).toBe(401);
  const replacement = setup();
  expect((await replacement.server.inject({ url: `${authPath}session`, headers })).statusCode).toBe(401);
  expect((await replacement.pair()).statusCode).toBe(200);
});

it('fences invalid or rolled-back clocks permanently and contains invalid Date errors', async () => {
  for (const invalid of [{ monotonic: 999 }, { monotonic: NaN }, { monotonic: Infinity }, { monotonic: -1 },
    { monotonic: Number.MAX_SAFE_INTEGER }, { wall: NaN }, { wall: Infinity }, { wall: 8.64e15 }, { wall: Date.UTC(10000, 0, 1) }]) {
    const { server, time, paired } = setup(); const { headers } = await paired();
    const original = { ...time };
    Object.assign(time, invalid);
    const response = await server.inject({ url: `${authPath}session`, headers });
    expect(response.statusCode).toBe(401); expect(response.json().code).toBe('unpaired');
    expect(response.headers['cache-control']).toBe('no-store');
    Object.assign(time, original);
    expect((await server.inject({ url: `${authPath}session`, headers })).statusCode).toBe(401);
  }
});

it('close is idempotent and revokes both pending bootstrap and existing session', async () => {
  const unpaired = setup(); unpaired.session.close(); unpaired.session.close();
  expect((await unpaired.pair()).statusCode).toBe(401);
  const { server, session, paired, pair } = setup(); const { headers } = await paired();
  session.close(); session.close();
  expect((await server.inject({ url: `${authPath}session`, headers })).statusCode).toBe(401);
  expect((await pair()).statusCode).toBe(401);
});

it('contains thrown clock failures and permanently fences authority even after the clock recovers', async () => {
  let fail = false;
  const { server, pair } = fixture({ clocks: {
    monotonicNow: () => { if (fail) throw new Error('SECRET_CLOCK_CANARY'); return 1000; },
    wallNow: () => Date.UTC(2026, 0, 1),
  } }); servers.push(server); fail = true;
  const response = await pair();
  expect(response.statusCode).toBe(401); expect(response.body).not.toContain('SECRET_CLOCK_CANARY');
  expect(response.headers['set-cookie']).toBeUndefined();
  fail = false; expect((await pair()).statusCode).toBe(401);
});

it('rejects close during pair admission or final grant and during session publication', async () => {
  for (const phase of ['admission', 'grant', 'publication']) {
    let action: (() => void) | undefined;
    let reads = 0;
    const { server, session, paired, pair } = fixture({ clocks: {
      monotonicNow: () => { reads++; action?.(); return 1000; }, wallNow: () => Date.UTC(2026, 0, 1),
    } }); servers.push(server);
    if (phase === 'publication') {
      const { headers } = await paired();
      const next = reads + 2;
      action = () => { if (reads === next) session.close(); };
      const response = await server.inject({ url: `${authPath}session`, headers });
      expect(response.statusCode).toBe(401);
    } else {
      const next = reads + (phase === 'admission' ? 1 : 2);
      action = () => { if (reads === next) session.close(); };
      const response = await pair();
      expect(response.statusCode).toBe(401); expect(response.headers['set-cookie']).toBeUndefined();
    }
  }
});

it('fences synchronous clock reentry even if the callback catches the nested failure', async () => {
  let reenter = false;
  const { server, session, pair } = fixture({ clocks: {
    monotonicNow: () => 1000,
    wallNow: () => {
      if (reenter) {
        // Invoke the actual guard synchronously, as a hostile injected clock could.
        const raw = ['Host', host, 'Origin', origin, 'Content-Type', 'application/json', 'X-Beetle-Pair', '1'];
        const request = { method: 'GET', raw: { rawHeaders: raw } };
        const reply = { header: () => reply };
        void owner.authorize.call(server, request as never, reply as never).catch(() => undefined);
      }
      return Date.UTC(2026, 0, 1);
    },
  } }); servers.push(server); const owner = session; reenter = true;
  const response = await pair();
  expect(response.statusCode).toBe(401); expect(response.headers['set-cookie']).toBeUndefined();
  reenter = false; expect((await pair()).statusCode).toBe(401);
});

it('snapshots trusted options and never exposes a predictable randomness option', async () => {
  const clocks = { monotonicNow: () => 1000, wallNow: () => Date.UTC(2026, 0, 1) };
  const options = { externalOrigin: origin, clocks };
  const { server, session } = fixture(options); servers.push(server);
  options.externalOrigin = 'http://foreign.invalid'; clocks.monotonicNow = () => NaN; clocks.wallNow = () => NaN;
  const response = await server.inject({ method: 'POST', url: `${authPath}pair`, headers: pairHeaders,
    payload: { bootstrapToken: session.bootstrapToken } });
  expect(response.statusCode).toBe(200);
  const fresh = createLocalSession({ externalOrigin: origin });
  expect(fresh.bootstrapToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(fresh.bootstrapToken).not.toBe(session.bootstrapToken); fresh.close();
});
