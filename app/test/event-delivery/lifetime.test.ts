import { expect, it, vi } from 'vitest';
import type { AckReceipt, ClientResult, EventBatch } from '@beetle/contracts';
import type { EventCursorState, EventIngestResult } from '../../src/ports/events.js';
import { binding, deferred, events, fixture, flush, receipt, state } from './fixture.js';

it('a stopped turn loads custody but never creates a gateway client', async () => {
  const f = fixture(); f.stop(); await f.collect();
  expect(f.store.load).toHaveBeenCalledTimes(1); expect(f.attempt).not.toHaveBeenCalled();
});

it('stop during load fences all new network issuance', async () => {
  const f = fixture(); const load = deferred<EventCursorState>();
  f.store.load.mockReturnValue(load.promise);
  const work = f.collect(); await flush(); f.stop(); load.resolve(state()); await work;
  expect(f.client.events).not.toHaveBeenCalled(); expect(f.client.ack).not.toHaveBeenCalled();
});

it('stop during a positive GET retains the original ingestion decision and forbids ACK', async () => {
  const f = fixture(); const get = deferred<ClientResult<EventBatch>>();
  f.client.events.mockReturnValue(get.promise);
  let settled = false; const work = f.collect().finally(() => { settled = true; });
  await flush(); f.stop(); await flush(); expect(settled).toBe(false);
  const batch = events(); get.resolve({ ok: true, value: batch }); await work;
  expect(f.store.ingest).toHaveBeenCalledExactlyOnceWith({ binding: binding(), after: 0, batch });
  expect(f.held.current.durableThrough).toBe(1); expect(f.client.ack).not.toHaveBeenCalled();
});

it('stop during ingestion drains the issued original and never issues a late ACK', async () => {
  const f = fixture(); const ingest = deferred<EventIngestResult>();
  f.store.ingest.mockReturnValue(ingest.promise);
  let settled = false; const work = f.collect().finally(() => { settled = true; });
  await flush(); expect(f.store.ingest).toHaveBeenCalledTimes(1); f.stop();
  await flush(); expect(settled).toBe(false);
  ingest.resolve({ state: state({ durableThrough: 1, retainedBytes: 1000, eventCount: 1 }), ackThrough: 1, inserted: 1 });
  await work; expect(f.client.ack).not.toHaveBeenCalled();
});

it('stop during ACK retains a late positive receipt through the original confirmation', async () => {
  const f = fixture(); const ack = deferred<ClientResult<AckReceipt>>(); const confirm = deferred<EventCursorState>();
  f.client.ack.mockReturnValue(ack.promise); f.store.confirmAck.mockReturnValue(confirm.promise);
  let settled = false; const work = f.collect().finally(() => { settled = true; });
  await flush(); expect(f.client.ack).toHaveBeenCalledTimes(1); f.stop();
  await flush(); expect(settled).toBe(false);
  ack.resolve({ ok: true, value: receipt() }); await flush();
  expect(f.store.confirmAck).toHaveBeenCalledTimes(1); expect(settled).toBe(false);
  confirm.resolve({ ...f.held.current, ackConfirmedThrough: 1 }); await work;
  expect(f.client.events).toHaveBeenCalledTimes(1); expect(settled).toBe(true);
});

it('stop during confirmation retains the original until its failure settles', async () => {
  const f = fixture(); const confirm = deferred<EventCursorState>();
  f.store.confirmAck.mockReturnValue(confirm.promise);
  const work = f.collect(); await flush(); f.stop();
  confirm.reject(new Error('original confirm failure'));
  await expect(work).rejects.toThrow('original confirm failure');
});

it('a concurrent problem cannot discard confirmation custody for an already-issued positive ACK', async () => {
  const f = fixture();
  f.client.ack.mockImplementation(async () => {
    f.held.current = { ...f.held.current, coverage: 'partial', blockedReason: 'cursor_expired', retainedStartSeq: 3 };
    f.stop(); return { ok: true, value: receipt() };
  });
  await f.collect();
  expect(f.store.confirmAck).toHaveBeenCalledTimes(1);
  expect(f.held.current).toMatchObject({ coverage: 'partial', blockedReason: 'cursor_expired', ackConfirmedThrough: 1 });
});

it('method replacement during load cannot redirect captured store methods or stop predicate', async () => {
  const f = fixture(); const load = deferred<EventCursorState>(); f.store.load.mockReturnValue(load.promise);
  const originalIngest = f.store.ingest; const originalConfirm = f.store.confirmAck;
  const work = f.collect();
  f.store.ingest = vi.fn(async () => { throw new Error('redirected ingest'); });
  f.store.confirmAck = vi.fn(async () => { throw new Error('redirected confirm'); });
  f.operations.stopped = () => true;
  load.resolve(state()); await work;
  expect(originalIngest).toHaveBeenCalledTimes(1); expect(originalConfirm).toHaveBeenCalledTimes(1);
  expect(f.store.ingest).not.toHaveBeenCalled(); expect(f.store.confirmAck).not.toHaveBeenCalled();
});

it('client methods are captured before GET and preserve the original receiver', async () => {
  const f = fixture(); const get = deferred<ClientResult<EventBatch>>(); const originalAck = f.client.ack;
  f.client.events.mockImplementation(function (this: typeof f.client) {
    expect(this).toBe(f.client); return get.promise;
  });
  const work = f.collect(); await flush();
  f.client.ack = vi.fn(async () => { throw new Error('redirected ACK'); });
  get.resolve({ ok: true, value: events() }); await work;
  expect(originalAck).toHaveBeenCalledTimes(1); expect(f.client.ack).not.toHaveBeenCalled();
});

it('gateway method replacement during load cannot redirect the original carrier', async () => {
  const f = fixture(); const load = deferred<EventCursorState>(); f.store.load.mockReturnValue(load.promise);
  const attempt = f.attempt;
  const work = f.collect(); f.operations.attempt = vi.fn(() => { throw new Error('redirected client'); });
  load.resolve(state()); await work; expect(attempt).toHaveBeenCalledTimes(1);
});

it('mutation of supplied binding during load cannot replace captured physical authority', async () => {
  const f = fixture(); const load = deferred<EventCursorState>(); f.store.load.mockReturnValue(load.promise);
  const selected = structuredClone(binding()); const work = f.collect(selected);
  Object.assign(selected, { journalAuthority: '44444444-4444-4444-8444-444444444444' });
  load.resolve(state()); await work;
  expect(f.store.ingest.mock.calls[0]![0].binding).toEqual(binding());
  expect(Object.isFrozen(f.store.ingest.mock.calls[0]![0].binding.key.attempt)).toBe(true);
});

it('an ACK lost confirm reply keeps a recoverable obligation on the next turn', async () => {
  const f = fixture(); const confirm = f.store.confirmAck.getMockImplementation()!;
  f.store.confirmAck.mockImplementationOnce(async request => { await confirm(request); throw new Error('lost confirm reply'); });
  await expect(f.collect()).rejects.toThrow('lost confirm reply');
  // The confirmation committed; the new load must observe its positive durable fact.
  f.client.events.mockResolvedValue({ ok: true, value: events(0, 1) });
  await f.collect();
  expect(f.client.ack).toHaveBeenCalledTimes(1); expect(f.store.confirmAck).toHaveBeenCalledTimes(1);
});
