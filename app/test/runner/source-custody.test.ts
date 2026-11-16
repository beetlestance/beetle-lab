import { expect, it, vi } from 'vitest';
import type { SourceChunkRequest } from '@beetle/contracts/output-source';
import { originalIdentity, envelope, selector, chunk, setup } from './source-fixtures.js';
import { identity, offer, turns } from './fixtures.js';

it('reserves the source two as a subset of ordinary eight before capture, separately from Offer two', async () => {
  const { gateway, client, native } = setup(true); const abort = new AbortController();
  const one = client.source(abort.signal); const two = gateway.output(originalIdentity()).sourceChunk(selector(), 32);
  let observed = 0;
  const hostile = new Proxy({} as SourceChunkRequest, { ownKeys() { observed++; throw new Error('must not capture'); } });
  expect(await client.sourceChunk(hostile, 32)).toEqual({ ok: false, error: { kind: 'transport' } });
  const ordinary = Array.from({ length: 6 }, () => gateway.attempt(originalIdentity()).snapshot());
  expect(await gateway.capabilities()).toEqual({ ok: false, error: { kind: 'transport' } });
  const offers = [gateway.attempt(identity).offer(offer()), gateway.attempt(identity).offer(offer())];
  expect(await gateway.attempt(identity).offer(offer())).toEqual({ ok: false, error: { kind: 'transport' } });
  expect(native.lookups).toHaveLength(10); expect(observed).toBe(0);
  abort.abort(); let settled = false; void one.then(() => { settled = true; }); await turns();
  expect(settled).toBe(false); expect(await client.sourceChunk(hostile, 32)).toEqual({ ok: false, error: { kind: 'transport' } });
  expect(observed).toBe(0); native.lookups[0]!.resolve([{ address: '127.0.0.1', family: 4 }]);
  expect(await one).toEqual({ ok: false, error: { kind: 'cancelled' } });
  const replacement = gateway.capabilities(); expect(native.lookups).toHaveLength(11);
  expect(await client.sourceChunk(hostile, 32)).toEqual({ ok: false, error: { kind: 'transport' } }); expect(observed).toBe(0);
  const closing = gateway.close(); expect(gateway.close()).toBe(closing);
  native.releaseDns(); await Promise.all([two, ...ordinary, ...offers, replacement, closing]);
  expect(native.io.request).not.toHaveBeenCalled();
});

it('refuses source admission when all ordinary credits are owned before request observation', async () => {
  const { gateway, client, native } = setup(true);
  const ordinary = Array.from({ length: 8 }, () => gateway.capabilities()); const get = vi.fn(() => 0);
  const input = Object.defineProperty(selector(), 'offset', { get });
  expect(await client.sourceChunk(input, 32)).toEqual({ ok: false, error: { kind: 'transport' } }); expect(get).not.toHaveBeenCalled();
  const closing = gateway.close(); native.releaseDns(); await Promise.all([...ordinary, closing]);
});

it('captures request expectations before held DNS and ignores later caller mutation', async () => {
  const { client, native } = setup(true); const input = selector(); const captured = { ...input };
  const pending = client.sourceChunk(input, 32); input.offset = 31; input.length = 1; input.sourceDigest = 'f'.repeat(64);
  native.releaseDns(); await turns(); const work = native.originals[0]!;
  expect(JSON.parse(work.request.end.mock.calls[0]![0]!)).toEqual(captured);
  work.body(chunk(Buffer.alloc(32, 7), captured)); work.close();
  expect(await pending).toEqual({ ok: true, value: chunk(Buffer.alloc(32, 7), captured) });
});

it.each(['abort', 'deadline', 'shutdown'] as const)('retains valid source EOF and all close custody through %s', async stop => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const { gateway, client, native } = setup(); const signal = new AbortController();
  const pending = client.source(signal.signal); const second = client.sourceChunk(selector(), 32); await turns();
  const work = native.originals[0]!; work.body(envelope()); let settled = false; void pending.then(() => { settled = true; });
  let closing: Promise<void> | undefined;
  if (stop === 'abort') signal.abort();
  if (stop === 'deadline') await vi.advanceTimersByTimeAsync(5001);
  if (stop === 'shutdown') closing = gateway.close();
  expect(work.request.destroy).toHaveBeenCalled();
  expect(await client.source()).toEqual({ ok: false, error: { kind: 'transport' } });
  work.request.emit('close'); work.socket.emit('close'); await turns();
  expect(settled).toBe(false); expect(await client.source()).toEqual({ ok: false, error: { kind: 'transport' } });
  work.request.emit('error', new Error('synthetic cleanup error')); work.response.emit('close');
  expect(await pending).toEqual({ ok: true, value: envelope() });
  const other = native.originals[1]!; other.body(chunk()); other.close(); await second;
  if (closing) { expect(gateway.close()).toBe(closing); await closing; }
});

it('does not release aborted source credit until request, response and socket close independently', async () => {
  const { gateway, client, native } = setup(); const abort = new AbortController();
  const pending = client.source(abort.signal); const second = client.source(); await turns();
  const work = native.originals[0]!; work.begin(); abort.abort();
  work.request.emit('close'); work.response.emit('close'); let settled = false; void pending.then(() => { settled = true; });
  await turns(); expect(settled).toBe(false); expect(await client.source()).toMatchObject({ ok: false, error: { kind: 'transport' } });
  work.socket.emit('close'); expect(await pending).toEqual({ ok: false, error: { kind: 'cancelled' } });
  const replacement = client.source(); await turns(); expect(native.originals).toHaveLength(3);
  const closing = gateway.close(); for (const original of native.originals.slice(1)) original.close();
  await Promise.all([second, replacement, closing]);
});

it('retains complete valid source EOF arriving after abort while its native originals drain', async () => {
  const { client, native } = setup(); const abort = new AbortController();
  const pending = client.source(abort.signal); await turns(); const work = native.originals[0]!;
  work.begin(); abort.abort(); work.response.emit('data', Buffer.from(JSON.stringify(envelope()))); work.response.emit('end');
  let settled = false; void pending.then(() => { settled = true; }); await turns(); expect(settled).toBe(false);
  work.close(); expect(await pending).toEqual({ ok: true, value: envelope() });
});

it('keeps gateway close pending for a held source response even after the other original resources close', async () => {
  const { gateway, client, native } = setup(); const pending = client.source(); await turns();
  const work = native.originals[0]!; work.begin(); const closing = gateway.close(); expect(gateway.close()).toBe(closing);
  let closed = false; void closing.then(() => { closed = true; }); work.request.emit('close'); work.socket.emit('close');
  await turns(); expect(closed).toBe(false);
  expect(await client.sourceChunk(selector(), 32)).toEqual({ ok: false, error: { kind: 'transport' } });
  work.response.emit('close'); await pending; await closing; expect(closed).toBe(true);
});
