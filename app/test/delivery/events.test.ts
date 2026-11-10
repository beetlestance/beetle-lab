import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ClientResult, EventBatch } from '@beetle/contracts';
import type { EventPage } from '../../src/ports/events.js';
import { fixture as eventFixture, binding, events } from '../event-delivery/fixture.js';
import { deferred, fixture, flush, tick } from './fixture.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function ready(order = 1) { return { kind: 'ready' as const, binding: binding(), order, after: `event-${order}` }; }
function connected() {
  const f = fixture(); const e = eventFixture();
  f.events.scan.mockResolvedValue({ items: [ready()], nextCursor: null });
  f.events.load.mockImplementation(e.store.load);
  f.events.ingest.mockImplementation(e.store.ingest);
  f.events.confirmAck.mockImplementation(e.store.confirmAck);
  f.events.recordProblem.mockImplementation(e.store.recordProblem);
  f.client.events.mockImplementation(async after => { e.calls.push('GET'); return { ok: true, value: events(1, after) }; }); f.client.ack.mockImplementation(e.client.ack);
  return { f, e };
}
it('gives events equal turns despite continuously ready queued and reconcile lanes', async () => {
  const { f, e } = connected(); const runtime = f.start();
  await tick(125); await runtime.close();
  expect(f.store.scan.mock.calls.map(([q]) => q.lane)).toEqual(['queued', 'reconcile', 'queued', 'reconcile']);
  expect(f.events.scan.mock.calls.map(([q]) => q)).toEqual([{ limit: 32 }, { limit: 32, cursor: 'event-1' }]);
  expect(f.client.events).toHaveBeenCalledTimes(2);
  expect(e.calls).toEqual(['load', 'GET', 'ingest', 'ACK', 'confirm', 'load', 'GET', 'ingest', 'ACK', 'confirm']);
  expect(e.held.current.durableThrough).toBe(2); expect(e.held.current.ackConfirmedThrough).toBe(2);
  expect(f.gateway.close).not.toHaveBeenCalled();
});
it('drains event discovery during close without loading or starting network work', async () => {
  const { f } = connected(); const pending = deferred<EventPage>(); f.events.scan.mockReturnValue(pending.promise);
  const runtime = f.start(); await tick(5000); const close = runtime.close();
  let closed = false; void close.then(() => { closed = true; }); await flush();
  expect(closed).toBe(false); expect(f.store.scan).toHaveBeenCalledTimes(2);
  expect(f.events.scan).toHaveBeenCalledTimes(1);
  pending.resolve({ items: [ready()], nextCursor: null }); await close;
  expect(f.events.load).not.toHaveBeenCalled(); expect(f.client.events).not.toHaveBeenCalled();
});
it('retains a received positive batch through close and does not send a late ACK', async () => {
  const { f, e } = connected(); const pending = deferred<ClientResult<EventBatch>>(); f.client.events.mockReturnValue(pending.promise);
  const runtime = f.start(); await tick(5000);
  expect(f.events.scan).toHaveBeenCalledTimes(1); const signal = f.client.events.mock.calls[0]![1];
  const close = runtime.close(); expect(signal?.aborted).toBe(true);
  pending.resolve({ ok: true, value: events() }); await close;
  expect(e.held.current.durableThrough).toBe(1); expect(f.events.ingest).toHaveBeenCalledTimes(1);
  expect(f.client.ack).not.toHaveBeenCalled(); expect(f.events.confirmAck).not.toHaveBeenCalled();
});
it('retains positive ACK confirmation custody through close', async () => {
  const { f, e } = connected(); const pending = deferred<Awaited<ReturnType<typeof e.client.ack>>>();
  f.client.ack.mockReturnValue(pending.promise); const runtime = f.start(); await tick(50);
  expect(f.client.ack).toHaveBeenCalledTimes(1); const close = runtime.close();
  pending.resolve(await e.client.ack({ ...binding().key.attempt, protocolVersion: '1.0', throughSeq: 1 })); await close;
  expect(e.held.current.ackConfirmedThrough).toBe(1); expect(f.events.confirmAck).toHaveBeenCalledTimes(1);
});
it('captures event methods before asynchronous work and retains failure notification', async () => {
  const { f } = connected(); const original = f.events.scan;
  const runtime = f.start(); f.events.scan = vi.fn(); original.mockRejectedValue(new Error('Event discovery unavailable'));
  await tick(50); await expect(runtime.close()).rejects.toThrow('Event discovery unavailable');
  expect(f.events.scan).not.toHaveBeenCalled(); expect(f.onFailure).toHaveBeenCalledTimes(1);
  expect(runtime.state().status).toBe('failed'); expect(f.client.events).not.toHaveBeenCalled();
});
