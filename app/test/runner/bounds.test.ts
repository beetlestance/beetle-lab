import { EventEmitter, once } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createRunnerGateway } from '../../src/adapters/outbound/runner/index.js';
import { openGateway } from '../../src/adapters/outbound/runner/gateway.js';
import type { NativeIo } from '../../src/adapters/outbound/runner/native.js';
import { ack, deferred, fixture, identity, loaded, loopback, offer, send, turns } from './fixtures.js';

async function rawServer(reply: Buffer | string) {
  const server = createServer(socket => {
    socket.once('data', () => socket.end(reply));
    socket.on('error', () => undefined);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  return { loaded: loaded(`http://127.0.0.1:${address.port}`),
    close: async () => { server.close(); await once(server, 'close'); } };
}

function heldTrailerOriginal() {
  const socket = Object.assign(new EventEmitter(), { closed: false, destroys: 0,
    destroy() { this.destroys++; } });
  const response = Object.assign(new EventEmitter(), { complete: true, destroys: 0,
    destroy() { this.destroys++; }, statusCode: 200,
    rawHeaders: ['Content-Type', 'application/json', 'Transfer-Encoding', 'chunked'],
    rawTrailers: ['X-Trailer', 'unsupported'],
    headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' } });
  const request = Object.assign(new EventEmitter(), { destroys: 0,
    destroy() { this.destroys++; }, end(): void { request.emit('socket', socket); } });
  return { request, response, socket };
}

describe('actual bounded Node request/response effects', () => {
  it('accepts exact maximum config in the larger Offer envelope, refuses config/envelope overflow before effects', async () => {
    let calls = 0;
    let bytes = 0;
    const server = await loopback((request, response) => {
      calls++;
      request.on('data', (chunk: Buffer) => { bytes += chunk.byteLength; });
      request.on('end', () => send(response, fixture('snapshot'), 202));
    });
    const gateway = createRunnerGateway(server.loaded);
    try {
      const client = gateway.attempt(identity);
      const body = offer();
      body.config = { payload: 'x'.repeat(1_048_576 - 14) };
      expect((await client.offer(body)).ok).toBe(true);
      expect(bytes).toBeGreaterThan(1_048_576);
      expect(bytes).toBeLessThanOrEqual(2_097_152);
      body.config = { payload: 'x'.repeat(1_048_576 - 13) };
      expect(await client.offer(body)).toMatchObject({ ok: false, error: { kind: 'request' } });
      body.config = { payload: 'x'.repeat(2_097_152) };
      expect(await client.offer(body)).toMatchObject({ ok: false, error: { kind: 'request' } });
      expect(await client.ack({ ...ack(), padding: 'x'.repeat(65_536) } as ReturnType<typeof ack>)).toMatchObject({ ok: false, error: { kind: 'request' } });
      expect(calls).toBe(1);
    } finally { await gateway.close(); await server.close(); }
  });

  const snapshot = JSON.stringify(fixture('snapshot'));
  const headers = 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n';
  function chunkedReply(trailerFields: number): string {
    const trailers = Array.from({ length: trailerFields }, (_, index) => `X-Trailer-${index}: value\r\n`).join('');
    return `${headers}Transfer-Encoding: chunked\r\n\r\n${Buffer.byteLength(snapshot).toString(16)}\r\n${snapshot}\r\n0\r\n${trailers}\r\n`;
  }

  it.each([1, 33])('rejects valid chunked JSON with %i unsupported trailer fields', async count => {
    const server = await rawServer(chunkedReply(count));
    const gateway = createRunnerGateway(server.loaded);
    try {
      expect(await gateway.attempt(identity).snapshot()).toEqual({ ok: false, error: { kind: 'response' } });
    } finally { await gateway.close(); await server.close(); }
  });

  it('accepts normal chunked JSON without trailers', async () => {
    const server = await rawServer(chunkedReply(0));
    const gateway = createRunnerGateway(server.loaded);
    try { expect(await gateway.attempt(identity).snapshot()).toEqual({ ok: true, value: fixture('snapshot') }); }
    finally { await gateway.close(); await server.close(); }
  });

  it('retains failed trailer response credit until request, response and socket originals close', async () => {
    const originals: ReturnType<typeof heldTrailerOriginal>[] = [];
    const io: NativeIo = { lookup: async () => [{ address: '127.0.0.1', family: 4 }],
      request: () => {
        const original = heldTrailerOriginal(); originals.push(original);
        return original.request as unknown as ClientRequest;
      } };
    const gateway = openGateway(loaded(), io);
    const client = gateway.attempt(identity);
    const calls = Array.from({ length: 8 }, () => client.snapshot());
    try {
      await turns();
      expect(originals).toHaveLength(8);
      const first = originals[0]!;
      first.request.emit('response', first.response as unknown as IncomingMessage);
      first.response.emit('data', Buffer.from(snapshot));
      first.response.emit('end');
      expect(first.request.destroys).toBeGreaterThan(0);
      expect(first.response.destroys).toBeGreaterThan(0);
      expect(first.socket.destroys).toBeGreaterThan(0);
      let settled = false; void calls[0]!.then(() => { settled = true; });
      first.request.emit('close'); first.response.emit('close');
      await turns();
      expect(settled).toBe(false);
      expect(await client.snapshot()).toEqual({ ok: false, error: { kind: 'transport' } });
      expect(originals).toHaveLength(8);
      first.socket.emit('close');
      expect(await calls[0]).toEqual({ ok: false, error: { kind: 'response' } });
      calls.push(client.snapshot());
      await turns();
      expect(originals).toHaveLength(9);
    } finally {
      const close = gateway.close();
      expect(gateway.close()).toBe(close);
      for (const original of originals) {
        original.request.emit('close'); original.response.emit('close'); original.socket.emit('close');
      }
      await Promise.all([...calls, close]);
    }
  });

  const replies = [
    { name: 'declared oversize', value: `${headers}Content-Length: 1048577\r\n\r\n` },
    { name: 'streamed oversize', value: `${headers}\r\n${'x'.repeat(1_048_577)}` },
    { name: 'partial content-length EOF', value: `${headers}Content-Length: ${Buffer.byteLength(snapshot) + 5}\r\n\r\n${snapshot}` },
    { name: 'partial JSON EOF', value: `${headers}\r\n{"protocolVersion":` },
    { name: 'compressed response', value: `${headers}Content-Encoding: gzip\r\n\r\n${snapshot}` },
    { name: 'unknown transfer encoding', value: `${headers}Transfer-Encoding: gzip\r\n\r\n${snapshot}` },
    { name: 'conflicting lengths', value: `${headers}Content-Length: 1\r\nContent-Length: 2\r\n\r\nx` },
    { name: 'length plus transfer encoding', value: `${headers}Content-Length: 1\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n` },
    { name: 'invalid length syntax', value: `${headers}Content-Length: +1\r\n\r\nx` },
    { name: 'excess header fields', value: `${headers}${Array.from({ length: 32 }, (_, index) => `X-Test-${index}: value\r\n`).join('')}\r\n${snapshot}` },
    { name: 'oversized headers', value: `${headers}X-Padding: ${'x'.repeat(16_384)}\r\n\r\n${snapshot}` },
    { name: 'invalid UTF8', value: Buffer.concat([Buffer.from(`${headers}\r\n`), Buffer.from([0xff])]) },
  ];

  it.each(replies)('rejects $name and drains native close', async ({ value }) => {
    const server = await rawServer(value);
    const gateway = createRunnerGateway(server.loaded);
    try { expect((await gateway.attempt(identity).snapshot()).ok).toBe(false); }
    finally { await gateway.close(); await server.close(); }
  });

  it.each(['offer', 'ack'] as const)('does not retry %s after the complete request is accepted and reply lost', async operation => {
    let calls = 0;
    const server = await loopback(request => {
      request.resume();
      request.on('end', () => { calls++; request.socket.destroy(); });
    });
    const gateway = createRunnerGateway(server.loaded);
    try {
      const client = gateway.attempt(identity);
      const result = await (operation === 'offer' ? client.offer(offer()) : client.ack(ack()));
      expect(result).toEqual({ ok: false, error: { kind: 'transport' } });
      expect(calls).toBe(1);
    } finally { await gateway.close(); await server.close(); }
  });

  it('aborts a real stalled socket and closes every original without changing caller signal', async () => {
    const accepted = deferred<void>();
    const server = await loopback(request => { request.resume(); accepted.resolve(); });
    const gateway = createRunnerGateway(server.loaded);
    const signal = new AbortController();
    const call = gateway.attempt(identity).snapshot(signal.signal);
    await accepted.promise;
    const close = gateway.close();
    expect(gateway.close()).toBe(close);
    expect(await call).toEqual({ ok: false, error: { kind: 'cancelled' } });
    await close;
    expect(signal.signal.aborted).toBe(false);
    await server.close();
  });
});
