import { request as httpRequest } from 'node:http';
import type { ClientRequest } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { fixture } from './fixtures.js';
import { HTTP_LIMITS } from '../../src/transport/index.js';

const f = fixture();
const clients = new Set<ClientRequest>();
afterEach(() => { for (const request of clients) request.destroy(); clients.clear(); });
interface Response { status: number; body: string }
function raw(port: number, path: string, headers: Record<string, string>, method = 'PUT') {
  let request!: ClientRequest;
  const response = new Promise<Response>(resolve => {
    request = httpRequest({ host: '127.0.0.1', port, path, method, headers }, reply => {
      let body = '';
      reply.on('data', (chunk: Buffer) => { body += chunk.toString(); if (body.length > 4096) reply.destroy(); });
      reply.on('end', () => resolve({ status: reply.statusCode!, body }));
      reply.on('error', () => resolve({ status: 0, body: '' }));
    });
    request.on('error', () => resolve({ status: 0, body: '' }));
  });
  clients.add(request); request.flushHeaders();
  return { request, response };
}
async function listening(server: Awaited<ReturnType<ReturnType<typeof fixture>['server']>>['server']) {
  await server.listen({ host: '127.0.0.1', port: 0 }); const address = server.server.address();
  if (!address || typeof address === 'string') throw new Error('loopback_address');
  return address.port;
}
it('accepts raw2MiB padded Offer and refuses2MiB+1 before enqueue', async () => {
  const e = await f.server(); const text = JSON.stringify(e.job);
  const payload = text + ' '.repeat(2_097_152 - Buffer.byteLength(text));
  const accepted = await e.server.inject({ method: 'PUT', url: e.path,
    headers: { ...e.headers, 'content-type': 'application/json' }, payload });
  expect(accepted.statusCode).toBe(202); expect(e.enqueue).toHaveBeenCalledTimes(1);
  const rejected = await e.server.inject({ method: 'PUT', url: e.path,
    headers: { ...e.headers, 'content-type': 'application/json' }, payload: payload + ' ' });
  expect(rejected.statusCode).toBe(413); expect(e.enqueue).toHaveBeenCalledTimes(1);
});
it('leaves cancel/ACK requests and all replies at1MiB', async () => {
  const e = await f.server(); await e.store(); const headers = { ...e.headers, 'content-type': 'application/json' };
  for (const suffix of ['cancel', 'ack']) {
    const response = await e.server.inject({ method: 'POST', url: `${e.path}/${suffix}`, headers,
      payload: ' '.repeat(HTTP_LIMITS.bytes + 1) });
    expect(response.statusCode).toBe(413);
  }
  expect(e.cancel).not.toHaveBeenCalled();
  e.setCapabilities(async () => ({ ...e.capabilities, padding: 'x'.repeat(HTTP_LIMITS.bytes) }));
  const response = await e.server.inject({ url: '/runner/v1/capabilities', headers: e.headers });
  expect(response.statusCode).toBe(500); expect(response.body.length).toBeLessThan(4096);
});
it('reserves two slots before parsing, refuses invalid credentials/scope/path first, and releases failures once', async () => {
  const e = await f.server(); let parsed = 0; let aborted = 0;
  e.server.addHook('preParsing', (request, _reply, payload, done) => {
    if (request.method === 'PUT') { parsed++; request.raw.once('aborted', () => { aborted++; }); }
    done(null, payload);
  });
  await e.store(); await e.journal.appendWrapper(f.wrapper()); const port = await listening(e.server);
  const headers = { ...e.headers, 'content-type': 'application/json' };
  const held = [raw(port, e.path, headers), raw(port, e.path, headers)];
  for (const request of held) request.request.write('{');
  await expect.poll(() => parsed).toBe(2);
  const invalid = [
    { path: e.path, headers: { ...headers, authorization: 'Bearer bad' }, status: 401 },
    { path: e.path, headers: { ...headers, 'x-beetle-workspace-id': 'invalid' }, status: 400 },
    { path: '/runner/v1/attempts/invalid', headers, status: 400 },
    { path: `${e.path}?extra=invalid`, headers, status: 400 },
    { path: e.path, headers: { ...headers, 'x-beetle-generation': '2' }, status: 409 },
  ];
  for (const test of invalid) {
    const value = raw(port, test.path, test.headers); value.request.end('{invalid');
    expect((await value.response).status).toBe(test.status);
  }
  expect(parsed).toBe(2);
  const third = raw(port, e.path, headers); third.request.end('{invalid');
  expect((await third.response).status).toBe(429); expect(parsed).toBe(2);
  expect((await e.server.inject({ url: '/runner/v1/capabilities', headers: e.headers })).statusCode).toBe(200);
  expect((await e.server.inject({ method: 'POST', url: `${e.path}/ack`, headers, payload: f.ack(1) })).statusCode).toBe(200);
  expect((await e.server.inject({ method: 'POST', url: `${e.path}/cancel`, headers,
    payload: { protocolVersion: '1.0', ...e.key } })).statusCode).toBe(200);
  held[0]!.request.destroy(); await held[0]!.response; await expect.poll(() => aborted).toBe(1);
  for (const [payload, status] of [['{invalid', 400], ['x'.repeat(2_097_153), 413]] as const) {
    const value = await e.server.inject({ method: 'PUT', url: e.path, headers, payload });
    expect(value.statusCode).toBe(status); expect(e.enqueue).not.toHaveBeenCalled();
  }
  const accepted = await e.server.inject({ method: 'PUT', url: e.path, headers, payload: e.job });
  expect(accepted.statusCode).toBe(202); expect(e.enqueue).toHaveBeenCalledTimes(1);
  // The second stalled parser remains charged after all other failure/response paths.
  const before = parsed; const another = raw(port, e.path, headers); another.request.write('{');
  await expect.poll(() => parsed).toBe(before + 1);
  expect((await e.server.inject({ method: 'PUT', url: e.path, headers, payload: e.job })).statusCode).toBe(429);
  held[1]!.request.destroy(); another.request.destroy();
});
it('retains credit through normal request close and aborted responses until original enqueue settles', async () => {
  const e = await f.server(); const snapshot = await e.store();
  const releases: (() => void)[] = [];
  e.enqueue.mockImplementation(() => new Promise(resolve => { releases.push(() => resolve({ accepted: true, snapshot })); }));
  const port = await listening(e.server); const headers = { ...e.headers, 'content-type': 'application/json' };
  const first = raw(port, e.path, headers); first.request.end(JSON.stringify(e.job));
  const second = raw(port, e.path, headers); second.request.end(JSON.stringify(e.job));
  await expect.poll(() => releases.length).toBe(2);
  first.request.destroy(); second.request.destroy(); await Promise.all([first.response, second.response]);
  expect((await e.server.inject({ method: 'PUT', url: e.path, headers, payload: e.job })).statusCode).toBe(429);
  expect(e.enqueue).toHaveBeenCalledTimes(2);
  expect((await e.server.inject({ url: '/runner/v1/capabilities', headers: e.headers })).statusCode).toBe(200);
  releases[0]!(); await new Promise(resolve => setImmediate(resolve));
  // A parse failure takes/releases only the credit belonging to this request.
  const response = await e.server.inject({ method: 'PUT', url: e.path, headers, payload: '{invalid' });
  expect(response.statusCode).toBe(400);
  releases[1]!();
});
it('preClose fences both lanes together, closes stalled parsers and drains original service work', async () => {
  const e = await f.server(); const snapshot = await e.store();
  let release!: () => void; e.enqueue.mockImplementation(() => new Promise(resolve => { release = () => resolve({ accepted: true, snapshot }); }));
  let parsed = 0; e.server.addHook('preParsing', (request, _reply, payload, done) => { if (request.method === 'PUT') parsed++; done(null, payload); });
  let serviceRelease!: () => void;
  e.setCapabilities(() => new Promise(resolve => { serviceRelease = () => resolve(e.capabilities); }));
  const port = await listening(e.server); const headers = { ...e.headers, 'content-type': 'application/json' };
  const issued = raw(port, e.path, headers); issued.request.end(JSON.stringify(e.job));
  await expect.poll(() => e.enqueue.mock.calls.length).toBe(1);
  const parser = raw(port, e.path, headers); parser.request.write('{');
  await expect.poll(() => parsed).toBe(2);
  const metadata = raw(port, '/runner/v1/capabilities', e.headers, 'GET'); metadata.request.end();
  await expect.poll(() => typeof serviceRelease).toBe('function');
  issued.request.destroy(); await issued.response;
  let closed = false; const closing = e.server.close().then(() => { closed = true; });
  await parser.response;
  await new Promise(resolve => setTimeout(resolve, 20)); expect(closed).toBe(false);
  // Fastify also fences the socket server; no new service or parser may enter during draining.
  const refused = raw(port, e.path, headers); refused.request.end(JSON.stringify(e.job));
  expect([0, 503]).toContain((await refused.response).status); expect(e.enqueue).toHaveBeenCalledTimes(1);
  serviceRelease(); expect((await metadata.response).status).toBe(200);
  await new Promise(resolve => setTimeout(resolve, 20)); expect(closed).toBe(false);
  release(); await closing; expect(closed).toBe(true);
});
