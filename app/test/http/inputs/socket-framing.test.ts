import { afterEach, expect, it } from 'vitest';
import { InputByteError } from '../../../src/ports/input-bytes.js';
import { storageFixture } from '../../storage/fixture.js';
import { setup, publish, wrap, deferred, turn, base } from './fixture.js';
import type { App } from './fixture.js';
import { listen, peer } from './socket-fixture.js';
const fixture = storageFixture();
const apps: App[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });

// Final service completion is explicitly modeled AFTER the actual native read.
// This tests wire framing; it does not inject or claim an actual OS close failure.
it.each([
  { partial: false, failure: false }, { partial: false, failure: true },
  { partial: true, failure: false }, { partial: true, failure: true },
])('keeps all received bytes incomplete until modeled read completion: %o', async ({ partial, failure }) => {
  const final = deferred<void>(); const reached = deferred<void>();
  const app = await setup(fixture, service => wrap(service, { read: async (...args) => {
    const record = await service.read(...args); reached.resolve(); await final.promise; return record;
  } })); apps.push(app);
  const record = await publish(app, 'abcdef'); const port = await listen(app);
  const client = peer(app, port, `${base}/${record.id}/content`, partial ? 3 : 6,
    { headers: partial ? { range: 'bytes=1-3' } : {} });
  client.req.end();
  try {
    const response = await client.received; await client.allBytes; await reached.promise; await turn();
    expect(response.statusCode).toBe(partial ? 206 : 200);
    expect(response.headers['transfer-encoding']).toBe('chunked'); expect(response.headers['content-length']).toBeUndefined();
    expect(client.body().toString()).toBe(partial ? 'bcd' : 'abcdef');
    expect(response.complete).toBe(false); expect(client.ended()).toBe(false);
    if (failure) final.reject(new InputByteError('cleanup')); else final.resolve();
    await client.closed;
    expect(response.complete).toBe(!failure); expect(client.ended()).toBe(!failure);
    expect(client.body().toString()).toBe(partial ? 'bcd' : 'abcdef');
  } finally { final.resolve(); client.req.destroy(); }
});

it.each([false, true])('withholds empty headers until modeled final completion; failure=%s', async failure => {
  const final = deferred<void>(); const reached = deferred<void>();
  const app = await setup(fixture, service => wrap(service, { read: async (...args) => {
    const record = await service.read(...args); reached.resolve(); await final.promise; return record;
  } })); apps.push(app);
  const record = await publish(app, ''); const port = await listen(app);
  const client = peer(app, port, `${base}/${record.id}/content`, 0); client.req.end();
  try {
    await reached.promise; await turn(); expect(client.response()).toBeUndefined(); expect(client.ended()).toBe(false);
    if (failure) final.reject(new InputByteError('cleanup')); else final.resolve();
    const response = await client.received; await client.closed;
    expect(response.statusCode).toBe(failure ? 503 : 200);
    if (!failure) { expect(response.headers['content-length']).toBe('0'); expect(response.complete).toBe(true); }
    else expect(client.body().toString()).not.toContain('cleanup');
  } finally { final.resolve(); client.req.destroy(); }
});

it('destroys a disconnected sink and HTTP.close retains the modeled original completion', async () => {
  const final = deferred<void>(); const reached = deferred<void>();
  const app = await setup(fixture, service => wrap(service, { read: async (...args) => {
    const record = await service.read(...args); reached.resolve(); await final.promise; return record;
  } })); apps.push(app);
  const record = await publish(app, 'abc'); const port = await listen(app);
  const client = peer(app, port, `${base}/${record.id}/content`, 3); client.req.end();
  try {
    await client.allBytes; await reached.promise; client.response()!.destroy(); await client.closed;
    let done = false; const closing = app.http.close().then(() => { done = true; });
    await turn(); expect(done).toBe(false);
    final.resolve(); await closing; expect(done).toBe(true);
  } finally { final.resolve(); client.req.destroy(); }
});
