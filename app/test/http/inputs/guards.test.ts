import { afterEach, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { storageFixture } from '../../storage/fixture.js';
import { setup, create, base, host, origin, wrap, scope, requestId, digest } from './fixture.js';
import type { App } from './fixture.js';
import { ChunkBody } from '../../../src/adapters/inbound/http/inputs/body.js';
import { ApiFault } from '../../../src/adapters/inbound/http/api-errors.js';
const fixture = storageFixture();
const apps: App[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });

it('rejects auth, shape, type and declared excess before service issue or any lazy source call', async () => {
  const append = vi.fn(); const read = vi.fn();
  const app = await setup(fixture, service => wrap(service, { append, read })); apps.push(app);
  const { record } = await create(app, 'a'); const url = `${base}/${record.id}/chunks?offset=0`;
  const headers = { ...app.headers, 'content-type': 'application/octet-stream' };
  const cases = [
    { headers: { host, origin, 'content-type': 'application/octet-stream' }, status: 401 },
    { headers: { ...headers, origin: 'http://localhost:9999' }, status: 403 },
    { headers: { ...headers, 'x-beetle-csrf': 'wrong' }, status: 403 },
    { headers: { ...headers, 'content-type': 'text/plain' }, status: 400 },
    { headers: { ...headers, 'content-type': 'application/octet-stream; charset=utf-8' }, status: 400 },
    { headers: { ...headers, 'content-length': '65537' }, status: 413 },
    { headers: { ...headers, 'content-length': '0' }, status: 400 },
    { headers: { ...headers, 'content-encoding': 'gzip' }, status: 400 },
  ];
  for (const item of cases) {
    const result = await app.server.inject({ method: 'PUT', url, headers: item.headers, payload: 'a' });
    expect(result.statusCode).toBe(item.status); expect(result.headers['cache-control']).toBe('no-store');
  }
  for (const query of ['', '?offset=00', '?offset=-1', '?offset=1e2', '?offset=8388609', '?offset=0&offset=0', '?offset=0&other=1']) {
    expect((await app.server.inject({ method: 'PUT', url: `${base}/${record.id}/chunks${query}`, headers, payload: 'a' })).statusCode).toBe(400);
  }
  const malformed = base.replace(scope.workspaceId, 'bad-id');
  expect((await app.server.inject({ method: 'PUT', url: `${malformed}/${record.id}/chunks?offset=0`, headers, payload: 'a' })).statusCode).toBe(400);
  for (const suffix of ['?x=1', '?x=']) {
    expect((await app.server.inject({ url: `${base}/${record.id}/content${suffix}`, headers: app.headers })).statusCode).toBe(400);
  }
  expect(append).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
});

it('bounds actual lazy chunk collection and preserves fixed body faults', async () => {
  const signal = new AbortController().signal;
  const legal = new ChunkBody(Readable.from([Buffer.alloc(32768), Buffer.alloc(32768)]), signal);
  expect((await legal.read()).byteLength).toBe(65536);
  const excess = new ChunkBody(Readable.from([Buffer.alloc(65536), Buffer.from('x')]), signal);
  await expect(excess.read()).rejects.toMatchObject({ code: 'body_limit' });
  expect(excess.fault?.statusCode).toBe(413);
  await expect(new ChunkBody(Readable.from([]), signal).read()).rejects.toMatchObject({ code: 'malformed_request' });
  const aborted = new AbortController(); aborted.abort();
  await expect(new ChunkBody(Readable.from([Buffer.from('x')]), aborted.signal).read()).rejects.toMatchObject({ code: 'storage_unavailable' });
});

it('replays the same create identity after an actual committed metadata write has an unknown response', async () => {
  let fail = true;
  const app = await setup(fixture, service => service, store => ({ control: async command => {
    const result = await store.control(command);
    if (fail) { fail = false; throw new ApiFault('storage_unavailable'); }
    return result;
  } })); apps.push(app);
  const payload = { scope, requestId: requestId(), name: 'Unknown receipt', sha256: digest(''), bytes: 0 };
  expect((await app.server.inject({ method: 'POST', url: base, headers: app.headers, payload })).statusCode).toBe(503);
  const rows = await app.service.list({ scope, limit: 100 }); expect(rows.items).toHaveLength(1);
  const replay = await app.server.inject({ method: 'POST', url: base, headers: app.headers, payload });
  expect(replay.statusCode).toBe(201); expect(replay.json().id).toBe(rows.items[0]!.id);
  expect((await app.service.list({ scope, limit: 100 })).items).toHaveLength(1);
});

it('does not publish after an unknown seal metadata result and replays the original receipt', async () => {
  let fail = true;
  const app = await setup(fixture, service => service, store => ({ control: async command => {
    const result = await store.control(command);
    if (command.kind === 'sealInput' && fail) { fail = false; throw new ApiFault('storage_unavailable'); }
    return result;
  } })); apps.push(app);
  const { record } = await create(app, 'abc'); const url = `${base}/${record.id}`;
  const upload = await app.server.inject({ method: 'PUT', url: `${url}/chunks?offset=0`,
    headers: { ...app.headers, 'content-type': 'application/octet-stream' }, payload: 'abc' });
  expect(upload.statusCode).toBe(200);
  const payload = { scope, requestId: requestId(), expectedVersion: upload.json().version };
  const unknown = await app.server.inject({ method: 'POST', url: `${url}/seal`, headers: app.headers, payload });
  expect(unknown.statusCode).toBe(503);
  expect(await app.service.get({ scope, id: record.id })).toMatchObject({ state: 'publishing', offset: 3 });
  const replay = await app.server.inject({ method: 'POST', url: `${url}/seal`, headers: app.headers, payload });
  expect(replay.statusCode).toBe(202); expect(replay.json()).toMatchObject({ operation: 'seal', requestId: payload.requestId, acceptedVersion: 3 });
  expect(await app.service.get({ scope, id: record.id })).toMatchObject({ state: 'published', offset: 3 });
});
