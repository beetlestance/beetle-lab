import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import { openGateway } from '../../src/adapters/outbound/runner/gateway.js';
import type { NativeIo } from '../../src/adapters/outbound/runner/native.js';
import { ack, fixture, identity, loaded, otherId, turns } from './fixtures.js';

afterEach(() => vi.useRealTimers());
function originalIo() {
  const socket = Object.assign(new EventEmitter(), { closed: false, destroy: vi.fn() });
  const request = Object.assign(new EventEmitter(), { destroy: vi.fn(), end: vi.fn(() => {
    request.emit('socket', socket as unknown as Socket);
  }) });
  const response = Object.assign(new EventEmitter(), { destroy: vi.fn(), complete: true,
    rawHeaders: ['Content-Type', 'application/json'], headers: { 'content-type': 'application/json' }, statusCode: 200 });
  const io: NativeIo = { lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    request: vi.fn(() => request as unknown as ClientRequest) };
  return { io, socket, request, response,
    body(value: unknown) {
      request.emit('response', response as unknown as IncomingMessage);
      response.emit('data', Buffer.from(JSON.stringify(value))); response.emit('end');
    },
    close() { response.emit('close'); request.emit('close'); socket.emit('close'); } };
}

it.each(['events', 'ack'] as const)('retains validated positive %s evidence after EOF while abort drains native originals', async method => {
  const native = originalIo(); const gateway = openGateway(loaded(), native.io);
  const client = gateway.attempt(identity);
  const result = method === 'events' ? client.events(0) : client.ack(ack());
  let settled = false; void result.then(() => { settled = true; });
  await turns(); const value = fixture(method === 'events' ? 'events' : 'ack-receipt'); native.body(value);
  await turns(); expect(settled).toBe(false);
  const closing = gateway.close();
  // A cleanup error after complete valid EOF does not erase already received bytes.
  native.request.emit('error', new Error('synthetic drain error'));
  await turns(); expect(settled).toBe(false);
  native.close(); expect(await result).toEqual({ ok: true, value }); await closing;
  expect(await client.events(0)).toEqual({ ok: false, error: { kind: 'transport' } });
});

it('retains completed validated evidence across deadline expiry while original resources remain owned', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const native = originalIo(); const gateway = openGateway(loaded(), native.io);
  const pending = gateway.attempt(identity).events(0); await turns();
  const value = fixture('events'); native.body(value);
  await vi.advanceTimersByTimeAsync(5001);
  let settled = false; void pending.then(() => { settled = true; });
  await turns(); expect(settled).toBe(false);
  native.close(); expect(await pending).toEqual({ ok: true, value }); await gateway.close();
});

it('never promotes malformed EOF to positive evidence during abort', async () => {
  const native = originalIo(); const gateway = openGateway(loaded(), native.io);
  const pending = gateway.attempt(identity).events(0); await turns();
  native.body({ notAnEventBatch: true }); const closing = gateway.close(); native.close();
  expect(await pending).toEqual({ ok: false, error: { kind: 'cancelled' } }); await closing;
});

it.each(['identity', 'status', 'incomplete', 'trailers'])('never promotes invalid %s evidence while abort drains', async issue => {
  const native = originalIo(); const gateway = openGateway(loaded(), native.io);
  const pending = gateway.attempt(identity).events(0); await turns();
  const body = fixture<Record<string, unknown>>('events');
  if (issue === 'identity') body.workspaceId = otherId;
  if (issue === 'status') native.response.statusCode = 202;
  if (issue === 'incomplete') native.response.complete = false;
  if (issue === 'trailers') Object.assign(native.response, { rawTrailers: ['x-synthetic', 'present'] });
  native.body(body); const closing = gateway.close(); native.close();
  expect((await pending).ok).toBe(false); await closing;
});
