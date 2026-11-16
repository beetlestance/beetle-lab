import { request } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { storageFixture } from '../../storage/fixture.js';
import { setup, create, wrap, deferred, turn, base } from './fixture.js';
import type { App } from './fixture.js';
import { listen, peer, discardErrors } from './socket-fixture.js';
const fixture = storageFixture();
const apps: App[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });

it('accepts actual chunked uploads, rejects actual excess with 413, and rejects empty bodies', async () => {
  const app = await setup(fixture); apps.push(app); const { record } = await create(app, 'abc'); const port = await listen(app);
  const client = peer(app, port, `${base}/${record.id}/chunks?offset=0`, 1,
    { headers: { 'content-type': 'application/octet-stream', 'transfer-encoding': 'chunked' }, method: 'PUT' });
  client.req.write('a'); client.req.write('bc'); client.req.end(); await client.closed;
  expect(client.response()!.statusCode).toBe(200); expect(JSON.parse(client.body().toString()).offset).toBe(3);
  for (const [size, status] of [[65537, 413], [0, 400]] as const) {
    const next = await create(app, 'a'.repeat(100000));
    const upload = peer(app, port, `${base}/${next.record.id}/chunks?offset=0`, 1,
      { headers: { 'content-type': 'application/octet-stream', 'transfer-encoding': 'chunked' }, method: 'PUT' });
    if (size) { upload.req.write(Buffer.alloc(65536)); upload.req.write(Buffer.from('x')); }
    upload.req.end(); await upload.closed;
    expect(upload.response()!.statusCode).toBe(status);
    expect(JSON.parse(upload.body().toString()).code).toBe(size ? 'body_limit' : 'malformed_request');
  }
});

it('holds two actual service sources, refuses a third, keeps metadata responsive, and drains on HTTP.close', async () => {
  const admitted = [deferred<void>(), deferred<void>()]; let sources = 0;
  const app = await setup(fixture, service => wrap(service, { append: (key, offset, source, context) =>
    service.append(key, offset, async () => { admitted[sources++]?.resolve(); return source(); }, context) })); apps.push(app);
  const records = await Promise.all([create(app, 'abc'), create(app, 'abc'), create(app, 'abc')]); const port = await listen(app);
  const clients = records.slice(0, 2).map(({ record }) => peer(app, port, `${base}/${record.id}/chunks?offset=0`, 1,
    { headers: { 'content-type': 'application/octet-stream', 'transfer-encoding': 'chunked' }, method: 'PUT' }));
  try {
    for (const client of clients) { client.req.write('a'); client.req.flushHeaders(); }
    await Promise.all(admitted.map(gate => gate.promise));
    const third = await app.server.inject({ method: 'PUT', url: `${base}/${records[2]!.record.id}/chunks?offset=0`,
      headers: { ...app.headers, 'content-type': 'application/octet-stream' }, payload: 'abc' });
    expect(third.statusCode).toBe(503); expect(sources).toBe(2);
    expect((await app.server.inject({ url: `${base}?limit=100`, headers: app.headers })).statusCode).toBe(200);
    expect((await app.server.inject({ url: `${base}/${records[0]!.record.id}`, headers: app.headers })).statusCode).toBe(200);
    await app.http.close(); await Promise.all(clients.map(client => client.closed));
    expect((await app.server.inject({ url: `${base}?limit=100`, headers: app.headers })).statusCode).toBe(503);
  } finally { for (const client of clients) client.req.destroy(); }
});

it('does not cancel on normal body close before a held actual offset acknowledgement', async () => {
  const accepted = deferred<void>(); const release = deferred<void>(); let aborted: boolean | undefined;
  const app = await setup(fixture, service => wrap(service, { append: async (...args) => {
    const record = await service.append(...args); accepted.resolve(); await release.promise;
    aborted = args[3]?.signal?.aborted; return record;
  } })); apps.push(app);
  const { record } = await create(app, 'abc'); const port = await listen(app);
  const client = peer(app, port, `${base}/${record.id}/chunks?offset=0`, 1,
    { headers: { 'content-type': 'application/octet-stream', 'content-length': '3' }, method: 'PUT' }); client.req.end('abc');
  try {
    await accepted.promise; await turn(); expect(client.response()).toBeUndefined();
    release.resolve(); await client.closed; expect(aborted).toBe(false);
    expect(client.response()!.statusCode).toBe(200); expect(JSON.parse(client.body().toString()).offset).toBe(3);
  } finally { release.resolve(); client.req.destroy(); }
});

it('aborts an incomplete actual body without advancing metadata', async () => {
  const admitted = deferred<void>();
  const app = await setup(fixture, service => wrap(service, { append: (key, offset, source, context) =>
    service.append(key, offset, async () => { admitted.resolve(); return source(); }, context) })); apps.push(app);
  const { record } = await create(app, 'abc'); const port = await listen(app);
  const req = request({ host: '127.0.0.1', port, path: `${base}/${record.id}/chunks?offset=0`, method: 'PUT',
    headers: { ...app.headers, 'content-type': 'application/octet-stream', 'content-length': '3' } });
  discardErrors(req); req.write('a'); await admitted.promise; req.destroy();
  await app.http.close();
  expect(await app.service.get({ scope: record.scope, id: record.id })).toMatchObject({ offset: 0, state: 'staging' });
});
