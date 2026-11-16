import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import type { Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Ack, Offer } from '@beetle/contracts';
import { openGateway } from '../../src/adapters/outbound/runner/gateway.js';
import type { NativeIo } from '../../src/adapters/outbound/runner/native.js';
import { deferred, fixture, identity, loaded, offer, turns } from './fixtures.js';

const addresses = [{ address: '127.0.0.1', family: 4 }];
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

function heldDns() {
  const lookups: ReturnType<typeof deferred<typeof addresses>>[] = [];
  const io: NativeIo = { lookup: vi.fn(() => {
    const work = deferred<typeof addresses>(); lookups.push(work); return work.promise;
  }), request: vi.fn(() => { throw new Error('synthetic-private-exception'); }) };
  return { io, lookups };
}

function heldSocket() {
  const socket = Object.assign(new EventEmitter(), { closed: false, destroy: vi.fn() });
  const request = Object.assign(new EventEmitter(), { destroy: vi.fn(), end: vi.fn(() => {
    request.emit('socket', socket as unknown as Socket);
  }) });
  const io: NativeIo = { lookup: async () => addresses, request: vi.fn(() => request as unknown as ClientRequest) };
  return { io, request, socket };
}

afterEach(() => vi.useRealTimers());

describe('original DNS/request/response/socket custody', () => {
  it('shares separate two/eight credits across facades, refuses before serialization, and retains aborted DNS', async () => {
    const native = heldDns();
    const gateway = openGateway(loaded(), native.io);
    const signal = new AbortController();
    const client = gateway.attempt(identity);
    const ordinary = Array.from({ length: 8 }, (_, index) => client.snapshot(index === 0 ? signal.signal : undefined));
    const offers = [client.offer(offer()), gateway.attempt(identity).offer(offer())];
    expect(native.lookups).toHaveLength(10);
    let serialized = 0;
    const hostile = new Proxy({}, { ownKeys: () => { serialized++; throw new Error('observed'); } }) as Offer;
    expect(await client.offer(hostile)).toEqual({ ok: false, error: { kind: 'transport' } });
    expect(await client.ack(hostile as unknown as Ack)).toEqual({ ok: false, error: { kind: 'transport' } });
    expect(await gateway.capabilities()).toEqual({ ok: false, error: { kind: 'transport' } });
    expect(serialized).toBe(0);
    signal.abort(new Error('private-caller-reason'));
    let settled = false;
    void ordinary[0]!.then(() => { settled = true; });
    await turns();
    expect(settled).toBe(false);
    expect(await gateway.capabilities()).toEqual({ ok: false, error: { kind: 'transport' } });
    native.lookups[0]!.resolve(addresses);
    expect(await ordinary[0]).toEqual({ ok: false, error: { kind: 'cancelled' } });
    const replacement = gateway.capabilities();
    expect(native.lookups).toHaveLength(11);
    const close = gateway.close();
    expect(gateway.close()).toBe(close);
    let closed = false; void close.then(() => { closed = true; });
    await turns(); expect(closed).toBe(false);
    expect(await client.snapshot()).toEqual({ ok: false, error: { kind: 'transport' } });
    for (const work of native.lookups.slice(1)) work.resolve(addresses);
    await Promise.all([...ordinary, ...offers, replacement, close]);
    expect(closed).toBe(true);
    expect(native.io.request).not.toHaveBeenCalled();
  });

  it('deadline retains original DNS promise/credits and close retains its drain promise', async () => {
    vi.useFakeTimers();
    const native = heldDns();
    const gateway = openGateway(loaded(), native.io);
    const calls = Array.from({ length: 8 }, () => gateway.capabilities());
    let settled = 0;
    for (const call of calls) void call.then(() => { settled++; });
    await vi.advanceTimersByTimeAsync(5001);
    expect(settled).toBe(0);
    expect(await gateway.capabilities()).toEqual({ ok: false, error: { kind: 'transport' } });
    const closing = gateway.close();
    expect(gateway.close()).toBe(closing);
    for (const work of native.lookups) work.resolve(addresses);
    expect(await Promise.all(calls)).toEqual(Array.from({ length: 8 }, () => ({ ok: false, error: { kind: 'timeout' } })));
    await closing;
    expect(native.io.request).not.toHaveBeenCalled();
  });

  it('retains request and socket close after abort; no new credit until both originals close', async () => {
    const native = heldSocket();
    const gateway = openGateway(loaded(), native.io);
    const abort = new AbortController();
    const call = gateway.attempt(identity).snapshot(abort.signal);
    await turns();
    let settled = false; void call.then(() => { settled = true; });
    abort.abort();
    expect(native.request.destroy).toHaveBeenCalled();
    native.request.emit('close');
    await turns(); expect(settled).toBe(false);
    const close = gateway.close();
    expect(gateway.close()).toBe(close);
    native.socket.emit('close');
    expect(await call).toEqual({ ok: false, error: { kind: 'cancelled' } });
    await close;
  });

  it('retains response close independently from successful EOF and request/socket close', async () => {
    const native = heldSocket();
    const gateway = openGateway(loaded(), native.io);
    const call = gateway.attempt(identity).snapshot();
    await turns();
    const response = Object.assign(new EventEmitter(), { destroy: vi.fn(), complete: true,
      rawHeaders: ['Content-Type', 'application/json'], headers: { 'content-type': 'application/json' }, statusCode: 200 });
    native.request.emit('response', response as unknown as IncomingMessage);
    response.emit('data', Buffer.from(JSON.stringify(fixture('snapshot'))));
    response.emit('end');
    native.request.emit('close'); native.socket.emit('close');
    let settled = false; void call.then(() => { settled = true; });
    await turns(); expect(settled).toBe(false);
    response.emit('close');
    expect((await call).ok).toBe(true);
    await gateway.close();
  });

  it('refuses the 4097th response fragment and keeps all close custody after the failure', async () => {
    const native = heldSocket();
    const gateway = openGateway(loaded(), native.io);
    const call = gateway.attempt(identity).snapshot();
    await turns();
    const response = Object.assign(new EventEmitter(), { destroy: vi.fn(), complete: true,
      rawHeaders: ['Content-Type', 'application/json'], headers: { 'content-type': 'application/json' }, statusCode: 200 });
    native.request.emit('response', response as unknown as IncomingMessage);
    for (let index = 0; index < 4097; index++) response.emit('data', Buffer.from(' '));
    expect(response.destroy).toHaveBeenCalled();
    let settled = false; void call.then(() => { settled = true; });
    native.request.emit('close'); response.emit('close');
    await turns(); expect(settled).toBe(false);
    native.socket.emit('close');
    expect(await call).toEqual({ ok: false, error: { kind: 'response' } });
    await gateway.close();
  });

  it.each([{ values: [] }, { values: Array.from({ length: 9 }, () => addresses[0]!) },
    { values: [{ address: 'not-an-ip', family: 4 }] }])(
    'refuses invalid or excessive DNS results without requesting', async ({ values }) => {
      const request = vi.fn(() => { throw new Error('must not issue'); });
      const gateway = openGateway(loaded(), { lookup: async () => values, request });
      expect(await gateway.capabilities()).toEqual({ ok: false, error: { kind: 'transport' } });
      expect(request).not.toHaveBeenCalled();
      await gateway.close();
    });

  it('uses one pinned address without fallback and sanitizes DNS/request rejection', async () => {
    const request = vi.fn((options: RequestOptions): ClientRequest => {
      expect(options.hostname).toBe('127.0.0.1');
      throw new Error('http://private.invalid/synthetic-token');
    });
    const gateway = openGateway(loaded(), { lookup: async () => [...addresses, { address: '127.0.0.2', family: 4 }], request });
    expect(await gateway.capabilities()).toEqual({ ok: false, error: { kind: 'transport' } });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toMatchObject({ hostname: '127.0.0.1', agent: false });
    await gateway.close();
    const native = heldDns();
    const rejecting = openGateway(loaded(), native.io);
    const call = rejecting.capabilities();
    await tick(); native.lookups[0]!.reject(new Error('private DNS detail'));
    expect(await call).toEqual({ ok: false, error: { kind: 'transport' } });
    await rejecting.close();
  });
});
