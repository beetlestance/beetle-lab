import { expect, it } from 'vitest';
import type { Capabilities, Offer } from '@beetle/contracts';
import { createHttpTransport, createRunnerClient } from '@beetle/contracts';
import { createAgentServer, HTTP_LIMITS } from '../../src/transport/index.js';
import { fixture, credential } from './fixtures.js';

const f = fixture();
it('serves all six private operations through actual runner client codecs and real SQLite', async () => {
  const e = await f.server();
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const response = await e.server.inject({ method: init?.method as 'GET' | 'PUT' | 'POST',
      url: url.pathname + url.search, headers: Object.fromEntries(new Headers(init?.headers).entries()),
      ...(typeof init?.body === 'string' ? { payload: init.body } : {}) });
    return new Response(response.body, { status: response.statusCode, headers: { 'content-type': 'application/json' } });
  };
  const client = createRunnerClient(createHttpTransport({ baseUrl: 'http://agent.test', fetch: fetcher, headers: e.headers }));
  expect(await client.capabilities()).toEqual({ ok: true, value: e.capabilities });
  expect((await client.offer(e.key.attemptId, e.job)).ok).toBe(true);
  expect((await client.snapshot(e.key.attemptId)).ok).toBe(true);
  await e.journal.appendWrapper(f.wrapper());
  const events = await client.events(e.key.attemptId, 0);
  expect(events.ok && events.value.events).toHaveLength(1);
  expect((await client.ack(e.key.attemptId, f.ack(1))).ok).toBe(true);
  expect((await client.cancel(e.key.attemptId, { protocolVersion: '1.0', ...e.key })).ok).toBe(true);
  expect((await e.journal.get(e.key)).cancelRequested).toBe(true);
});
it('authenticates before malformed body parsing and never invokes a service without the credential', async () => {
  const e = await f.server();
  for (const authorization of [undefined, 'Bearer bad', `Bearer ${'X'.repeat(64)}`]) {
    const response = await e.server.inject({ method: 'PUT', url: e.path,
      headers: { ...(authorization ? { authorization } : {}), 'content-type': 'application/json' }, payload: '{invalid' });
    expect(response.statusCode).toBe(401); expect(response.body).toBe('');
  }
  expect(e.enqueue).not.toHaveBeenCalled();
});
it('rejects browser metadata, duplicate credentials and missing scope without effects', async () => {
  const e = await f.server();
  for (const extra of [{ origin: 'http://localhost' }, { cookie: 'anything=1' }, { 'sec-fetch-site': 'same-origin' }]) {
    expect((await e.server.inject({ url: e.path, headers: { ...e.headers, ...extra } })).statusCode).toBe(403);
  }
  const { authorization, ...scoped } = e.headers;
  const duplicated = await e.server.inject({ url: e.path, headers: { ...scoped,
    Authorization: [authorization, authorization] } });
  expect([401, 403]).toContain(duplicated.statusCode);
  const missing = await e.server.inject({ url: e.path, headers: { authorization: `Bearer ${credential}` } });
  expect(missing.statusCode).toBe(400); expect(missing.body).toBe('');
  expect(e.enqueue).not.toHaveBeenCalled(); expect(e.events).not.toHaveBeenCalled();
});
it('fences path/body/header scope mismatches and stale read generations', async () => {
  const e = await f.server(); await e.store();
  const other = '00000000-0000-4000-8000-000000000099';
  const mismatch = await e.server.inject({ method: 'PUT', url: e.path, headers: e.headers,
    payload: { ...e.job, workspaceId: other } });
  expect(mismatch.statusCode).toBe(409); expect(e.enqueue).not.toHaveBeenCalled();
  const stale = await e.server.inject({ url: `${e.path}/events?after=0`, headers: { ...e.headers, 'x-beetle-generation': '2' } });
  expect(stale.statusCode).toBe(409); expect(e.events).not.toHaveBeenCalled();
  const foreign = await e.server.inject({ url: e.path, headers: { ...e.headers, 'x-beetle-organization-id': other } });
  expect(foreign.statusCode).toBe(404); expect(foreign.body).not.toContain(e.key.organizationId);
});
it('accepts only canonical bounded cursors and no unknown query fields', async () => {
  const e = await f.server(); await e.store();
  for (const query of ['after=00', 'after=-1', 'after=1e2', 'after=9007199254740992', 'after=0&after=1', 'after=0&extra=secret']) {
    const result = await e.server.inject({ url: `${e.path}/events?${query}`, headers: e.headers });
    expect(result.statusCode).toBe(400); expect(result.body).not.toContain('secret');
  }
  expect((await e.server.inject({ url: `${e.path}?unknown=secret`, headers: e.headers })).statusCode).toBe(400);
  expect(e.events).not.toHaveBeenCalled();
});
it('bounds bodies and returns safe protocol errors instead of config or parser exception text', async () => {
  const e = await f.server(); const canary = 'SYNTHETIC_PRIVATE_CANARY';
  for (const payload of [{ ...e.job, unknown: canary }, '{malformed-json']) {
    const result = await e.server.inject({ method: 'PUT', url: e.path,
      headers: { ...e.headers, 'content-type': 'application/json' }, payload });
    expect(result.statusCode).toBe(400); expect(result.body).not.toContain(canary);
    expect(result.json()).toMatchObject({ protocolVersion: '1.0', issues: [] });
  }
  const large = await e.server.inject({ method: 'PUT', url: e.path,
    headers: { ...e.headers, 'content-type': 'application/json' }, payload: 'x'.repeat(HTTP_LIMITS.bytes + 1) });
  expect(large.statusCode).toBe(413); expect(e.enqueue).not.toHaveBeenCalled();
});
it('validates bounded response objects before observing getters or reflecting service exceptions', async () => {
  const e = await f.server(); let reads = 0;
  e.setCapabilities(async () => ({ ...e.capabilities, get protocolVersion() { reads++; return '1.0' as const; } }));
  let result = await e.server.inject({ url: '/runner/v1/capabilities', headers: e.headers });
  expect(result.statusCode).toBe(500); expect(reads).toBe(0);
  e.enqueue.mockRejectedValueOnce(new Error('SYNTHETIC_SERVICE_SECRET'));
  result = await e.server.inject({ method: 'PUT', url: e.path, headers: e.headers, payload: e.job });
  expect(result.statusCode).toBe(500); expect(result.body).not.toContain('SYNTHETIC_SERVICE_SECRET');
});
it('holds the service-operation allowance through original pending promises', async () => {
  const e = await f.server(); let resolve!: (value: Capabilities) => void; let calls = 0;
  const pending = new Promise<Capabilities>(done => { resolve = done; });
  e.setCapabilities(() => { calls++; return pending; });
  const requests = Array.from({ length: HTTP_LIMITS.operations }, () => e.server.inject({ url: '/runner/v1/capabilities', headers: e.headers }));
  await expect.poll(() => calls).toBe(HTTP_LIMITS.operations);
  const overflow = await e.server.inject({ url: '/runner/v1/capabilities', headers: e.headers });
  expect(overflow.statusCode).toBe(429); expect(calls).toBe(HTTP_LIMITS.operations);
  resolve(e.capabilities); expect((await Promise.all(requests)).every(response => response.statusCode === 200)).toBe(true);
  expect((await e.server.inject({ url: '/runner/v1/capabilities', headers: e.headers })).statusCode).toBe(200);
});
it('refuses weak installation credentials and unknown endpoints without echoing URL contents', async () => {
  const e = await f.server();
  expect(() => createAgentServer({ credential: 'weak', capabilities: async () => e.capabilities,
    installation: { enqueue: e.enqueue, cancel: e.cancel }, journal: e.journal })).toThrow(TypeError);
  const response = await e.server.inject({ url: '/unknown/SYNTHETIC_QUERY_SECRET', headers: e.headers });
  expect(response.statusCode).toBe(404); expect(response.body).not.toContain('SYNTHETIC_QUERY_SECRET');
});
it('never returns a foreign but structurally valid service snapshot', async () => {
  const e = await f.server(); const snapshot = await e.store(); const other = '00000000-0000-4000-8000-000000000099';
  e.enqueue.mockResolvedValueOnce({ accepted: true, snapshot: { ...snapshot, workspaceId: other } });
  const response = await e.server.inject({ method: 'PUT', url: e.path, headers: e.headers, payload: e.job as Offer });
  expect(response.statusCode).toBe(500); expect(response.body).not.toContain(other);
});
it('server shutdown waits for original pending metadata work', async () => {
  const e = await f.server(); let resolve!: (value: Capabilities) => void; let started = false;
  const original = new Promise<Capabilities>(done => { resolve = done; });
  e.setCapabilities(() => { started = true; return original; });
  const request = e.server.inject({ url: '/runner/v1/capabilities', headers: e.headers });
  await expect.poll(() => started).toBe(true);
  let finished = false; const closing = e.server.close().then(() => { finished = true; });
  await new Promise(resolve => setTimeout(resolve, 20)); expect(finished).toBe(false);
  resolve(e.capabilities); expect((await request).statusCode).toBe(200); await closing; expect(finished).toBe(true);
});
it('bounds query parsing and URL lengths before any journal/service effect', async () => {
  const e = await f.server(); await e.store();
  const query = await e.server.inject({ url: `${e.path}/events?after=${'1'.repeat(200)}`, headers: e.headers });
  expect(query.statusCode).toBe(400); expect(e.events).not.toHaveBeenCalled();
  const url = await e.server.inject({ url: `${e.path}?secret=${'x'.repeat(2048)}`, headers: e.headers });
  expect(url.statusCode).toBe(414); expect(url.body).not.toContain('secret');
});
it('rejects a foreign nested event in an otherwise valid scoped response batch', async () => {
  const e = await f.server(); await e.store(); await e.journal.appendWrapper(f.wrapper());
  const batch = await e.journal.readEvents(e.key, 0); const other = '00000000-0000-4000-8000-000000000099';
  e.events.mockResolvedValueOnce({ ...batch, events: batch.events.map(event => ({ ...event, workspaceId: other })) });
  const response = await e.server.inject({ url: `${e.path}/events?after=0`, headers: e.headers });
  expect(response.statusCode).toBe(500); expect(response.body).not.toContain(other);
});
