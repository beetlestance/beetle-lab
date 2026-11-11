import { expect, it, vi } from 'vitest';
import { sourceFixture, deferred } from './source-fixture.js';
import { HTTP_LIMITS } from '../../src/transport/index.js';

const f = sourceFixture();
it('refuses source body admission when ordinary originals alone fill all32 shared credits', async () => {
  const e = await f.server(); const release = deferred<void>(); let parsed = 0;
  e.cap.mockImplementation(async () => { await release.promise; return e.capabilities; });
  e.server.addHook('preParsing', (request, _reply, payload, done) => {
    if (request.url.endsWith('/source/chunk')) parsed++; done(null, payload);
  });
  const port = await f.listen(e.server);
  const requests = Array.from({ length: HTTP_LIMITS.operations }, () => {
    const r = f.raw(port, '/runner/v1/capabilities', e.headers); r.client.end(); return r;
  });
  try {
    await expect.poll(() => e.cap.mock.calls.length).toBe(32);
    const response = await e.server.inject({ method: 'POST', url: `${e.path}/chunk`, headers: e.headers, payload: '{invalid' });
    expect(response.statusCode).toBe(429); expect(parsed).toBe(0); expect(e.getChunk).not.toHaveBeenCalled();
  } finally { release.resolve(); }
  expect((await Promise.all(requests.map(r => r.response))).every(r => r.status === 200)).toBe(true);
});
it('atomically charges the same32 originals and source2 before body parse and releases failed parsers only after socket cleanup', async () => {
  const e = await f.server(); const release = deferred<void>();
  e.cap.mockImplementation(async () => { await release.promise; return e.capabilities; });
  let parsed = 0; const parserCloses: Promise<void>[] = [];
  e.server.addHook('preParsing', (request, _reply, payload, done) => {
    if (request.url.endsWith('/source/chunk')) {
      parsed++; parserCloses.push(new Promise(resolve => request.raw.socket.once('close', () => resolve())));
    }
    done(null, payload);
  });
  const port = await f.listen(e.server);
  const metadata = Array.from({ length: 30 }, () => { const r = f.raw(port, '/runner/v1/capabilities', e.headers); r.client.end(); return r; });
  await expect.poll(() => e.cap.mock.calls.length).toBe(30);
  const parsers = Array.from({ length: 2 }, () => {
    const r = f.raw(port, `${e.path}/chunk`, e.headers, 'POST'); r.client.write('{'); return r;
  });
  try {
    await expect.poll(() => parsed).toBe(2);
    const ordinary = await e.server.inject({ url: '/runner/v1/capabilities', headers: e.headers });
    expect(ordinary.statusCode).toBe(429); expect(e.cap).toHaveBeenCalledTimes(30);
    const source = await e.server.inject({ method: 'POST', url: `${e.path}/chunk`, headers: e.headers, payload: '{invalid' });
    expect(source.statusCode).toBe(429); expect(parsed).toBe(2); expect(e.getChunk).not.toHaveBeenCalled();
    for (const parser of parsers) parser.client.destroy(); await Promise.all(parsers.map(p => p.response));
    await Promise.all(parserCloses);
    const accepted = await e.server.inject({ method: 'POST', url: `${e.path}/chunk`, headers: e.headers, payload: e.selector });
    expect(accepted.statusCode).toBe(200); expect(e.getChunk).toHaveBeenCalledTimes(1);
  } finally { for (const parser of parsers) parser.client.destroy(); release.resolve(); }
  expect((await Promise.all(metadata.map(r => r.response))).every(r => r.status === 200)).toBe(true);
});
it('retains both source originals after disconnect until their actual service promises settle', async () => {
  const e = await f.server(); const first = deferred<void>(); const second = deferred<void>();
  e.getSource.mockImplementationOnce(async () => { await first.promise; return e.envelope; });
  e.getChunk.mockImplementationOnce(async () => { await second.promise; return e.chunk; });
  const port = await f.listen(e.server);
  const a = f.raw(port, e.path, e.headers); a.client.end();
  const b = f.raw(port, `${e.path}/chunk`, e.headers, 'POST'); b.client.end(JSON.stringify(e.selector));
  try {
    await expect.poll(() => e.getSource.mock.calls.length + e.getChunk.mock.calls.length).toBe(2);
    a.client.destroy(); b.client.destroy(); await Promise.all([a.response, b.response]);
    await expect.poll(() => e.getSource.mock.calls[0]![1].signal!.aborted).toBe(true);
    expect((await e.server.inject({ url: e.path, headers: e.headers })).statusCode).toBe(429);
    expect((await e.server.inject({ url: '/runner/v1/capabilities', headers: e.headers })).statusCode).toBe(200);
    first.resolve(); await new Promise(resolve => setImmediate(resolve));
    expect((await e.server.inject({ url: e.path, headers: e.headers })).statusCode).toBe(200);
    expect(e.getSource).toHaveBeenCalledTimes(2); expect(e.getChunk).toHaveBeenCalledTimes(1);
  } finally { first.resolve(); second.resolve(); }
});
it('fences a delayed handler after pre-service disconnect and waits socket cleanup rather than issuing late work', async () => {
  const e = await f.server(); const entered = deferred<void>(); const release = deferred<void>(); const disconnected = deferred<void>();
  e.server.addHook('preHandler', async request => {
    if (request.url === e.path) {
      request.raw.socket.once('close', () => disconnected.resolve()); entered.resolve(); await release.promise;
    }
  });
  const port = await f.listen(e.server); const client = f.raw(port, e.path, e.headers); client.client.end();
  await entered.promise; client.client.destroy(); await client.response;
  await disconnected.promise; release.resolve();
  await new Promise(resolve => setImmediate(resolve)); expect(e.getSource).not.toHaveBeenCalled();
  const chunk = await e.server.inject({ method: 'POST', url: `${e.path}/chunk`, headers: e.headers, payload: e.selector });
  expect(chunk.statusCode).toBe(200);
});
it('holds source credit after service completion while actual response and sockets are still pending', async () => {
  const e = await f.server(); const release = deferred<void>(); let responses = 0;
  e.server.addHook('onSend', async (request, _reply, payload) => {
    if (request.url === e.path) { responses++; await release.promise; } return payload;
  });
  const port = await f.listen(e.server);
  const clients = Array.from({ length: 2 }, () => { const r = f.raw(port, e.path, e.headers); r.client.end(); return r; });
  try {
    await expect.poll(() => responses).toBe(2); expect(e.getSource).toHaveBeenCalledTimes(2);
    const overflow = await e.server.inject({ method: 'POST', url: `${e.path}/chunk`, headers: e.headers, payload: e.selector });
    expect(overflow.statusCode).toBe(429); expect(e.getChunk).not.toHaveBeenCalled();
    expect((await e.server.inject({ url: '/runner/v1/capabilities', headers: e.headers })).statusCode).toBe(200);
  } finally { release.resolve(); }
  expect((await Promise.all(clients.map(client => client.response))).every(response => response.status === 200)).toBe(true);
});
it('preClose fences all lanes, destroys unissued parsers and drains held source plus ordinary originals', async () => {
  const e = await f.server(); const source = deferred<void>(); const metadata = deferred<void>();
  e.getSource.mockImplementation(async () => { await source.promise; return e.envelope; });
  e.cap.mockImplementation(async () => { await metadata.promise; return e.capabilities; });
  let parsed = 0; e.server.addHook('preParsing', (request, _reply, payload, done) => {
    if (request.url.endsWith('/source/chunk')) parsed++; done(null, payload);
  });
  const port = await f.listen(e.server); const get = f.raw(port, e.path, e.headers); get.client.end();
  const cap = f.raw(port, '/runner/v1/capabilities', e.headers); cap.client.end();
  const parser = f.raw(port, `${e.path}/chunk`, e.headers, 'POST'); parser.client.write('{');
  await expect.poll(() => e.getSource.mock.calls.length === 1 && e.cap.mock.calls.length === 1 && parsed === 1).toBe(true);
  let closed = false; const closing = e.server.close().then(() => { closed = true; });
  try {
    await Promise.all([get.response, parser.response]);
    await new Promise(resolve => setImmediate(resolve)); expect(closed).toBe(false); expect(e.getChunk).not.toHaveBeenCalled();
    expect(e.getSource.mock.calls[0]![1].signal!.aborted).toBe(true);
    metadata.resolve(); expect((await cap.response).status).toBe(200);
    await new Promise(resolve => setImmediate(resolve)); expect(closed).toBe(false);
  } finally { source.resolve(); metadata.resolve(); }
  await closing; expect(closed).toBe(true);
});
it('treats the request deadline as a stop hint while both actual service originals remain charged', async () => {
  const e = await f.server(); const issued = deferred<void>(); const release = deferred<void>(); let calls = 0;
  e.getSource.mockImplementation(async () => { if (++calls === 2) issued.resolve(); await release.promise; return e.envelope; });
  const port = await f.listen(e.server);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const clients = Array.from({ length: 2 }, () => { const r = f.raw(port, e.path, e.headers); r.client.end(); return r; });
  try {
    await issued.promise; await vi.advanceTimersByTimeAsync(HTTP_LIMITS.requestMs); vi.useRealTimers();
    await Promise.all(clients.map(client => client.response));
    expect(e.getSource.mock.calls.every(call => call[1].signal!.aborted)).toBe(true);
    expect((await e.server.inject({ url: e.path, headers: e.headers })).statusCode).toBe(429);
    expect(e.getSource).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); release.resolve(); }
});
