import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AttemptSnapshot, ClientResult } from '@beetle/contracts';
import type { DispatchClaim, DispatchObservation, DispatchOffer, DispatchPage } from '../../src/ports/dispatch.js';
import { deferred, fixture, flush, missing, positive, runValue, tick } from './fixture.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
it('close before first timer does no work and shares its completion', async () => {
  const f = fixture(); const runtime = f.start(); const close = runtime.close();
  expect(runtime.close()).toBe(close); await close; await tick(1000);
  expect(f.store.scan).not.toHaveBeenCalled(); expect(runtime.state()).toEqual({ status: 'closed', active: false, reason: null });
});
it('captures option methods and interval before asynchronous work', async () => {
  const f = fixture(); const originalObserve = f.store.observe;
  const runtime = f.start();
  f.options.intervalMs = 60_000; f.options.onFailure = vi.fn();
  f.store.scan = vi.fn(); f.store.readOffer = vi.fn(); f.store.claim = vi.fn(); f.store.observe = vi.fn();
  f.options.runs.getRun = vi.fn(); f.gateway.attempt = vi.fn();
  await tick(25); await runtime.close();
  expect(originalObserve).toHaveBeenCalledTimes(2);
  expect(f.store.scan).not.toHaveBeenCalled(); expect(f.gateway.attempt).not.toHaveBeenCalled();
});
it.each([0, 24, 60_001, 25.5, Infinity, NaN])('rejects invalid interval %s before work', intervalMs => {
  const f = fixture(); f.options.intervalMs = intervalMs;
  expect(() => f.start()).toThrow('Invalid delivery interval');
  expect(f.store.scan).not.toHaveBeenCalled();
});
it('holds one scan original without scheduling overlap', async () => {
  const f = fixture(); const pending = deferred<DispatchPage>(); f.store.scan.mockReturnValue(pending.promise);
  const runtime = f.start(); await tick(5000);
  expect(f.store.scan).toHaveBeenCalledTimes(1); expect(runtime.state().active).toBe(true);
  const close = runtime.close(); let closed = false; void close.then(() => { closed = true; });
  await flush(); expect(closed).toBe(false);
  pending.resolve({ items: [], nextCursor: null }); await close;
  expect(f.store.readOffer).not.toHaveBeenCalled();
});
it('holds one Offer read through close and issues no claim', async () => {
  const f = fixture(); const pending = deferred<DispatchOffer>(); f.store.readOffer.mockReturnValue(pending.promise);
  const runtime = f.start(); await tick(5000);
  expect(f.store.readOffer).toHaveBeenCalledTimes(1); expect(f.store.scan).toHaveBeenCalledTimes(1);
  const close = runtime.close(); let closed = false; void close.then(() => { closed = true; });
  await flush(); expect(closed).toBe(false);
  pending.resolve({ key: f.key, offer: {} as never }); await close;
  expect(f.store.claim).not.toHaveBeenCalled();
});
it('awaits original claim after abort without starting HTTP', async () => {
  const f = fixture(); const pending = deferred<DispatchClaim>(); f.store.claim.mockReturnValue(pending.promise);
  const runtime = f.start(); await tick(); const close = runtime.close();
  pending.resolve({ kind: 'claimed', key: f.key, journalAuthority: '33333333-3333-4333-8333-333333333333' });
  await close; expect(f.gateway.attempt).not.toHaveBeenCalled();
});
it('checks close after last awaited Run decision', async () => {
  const f = fixture(); const pending = deferred<ReturnType<typeof runValue>>(); f.getRun.mockReturnValue(pending.promise);
  const runtime = f.start(); await tick(); const close = runtime.close(); pending.resolve(runValue());
  await close; expect(f.client.offer).not.toHaveBeenCalled();
});
it.each(['offer', 'snapshot', 'cancel', 'cancelOriginal'] as const)('drains received positive %s into observation after close', async operation => {
  const f = fixture(); const pending = deferred<ClientResult<AttemptSnapshot>>();
  const custody = deferred<DispatchObservation>(); f.store.observe.mockReturnValue(custody.promise);
  if (operation !== 'offer') f.claim('replay');
  if (operation === 'cancelOriginal') f.run.cancellationRequested = true;
  if (operation === 'cancel') {
    f.run.cancellationRequested = true;
    f.client.snapshot.mockResolvedValue(positive());
    f.store.observe.mockResolvedValueOnce({ run: f.run, snapshot: positive().value,
      executionCharged: true, runChanged: false });
  }
  f.client[operation].mockReturnValue(pending.promise);
  const runtime = f.start(); await tick();
  const signal = f.client[operation].mock.calls[0]!.at(-1) as AbortSignal;
  const close = runtime.close(); expect(signal.aborted).toBe(true);
  let closed = false; void close.then(() => { closed = true; });
  await tick(5000); expect(closed).toBe(false); expect(f.store.scan).toHaveBeenCalledTimes(1);
  pending.resolve(positive()); await flush(); expect(closed).toBe(false);
  expect(f.store.observe).toHaveBeenCalledTimes(operation === 'cancel' ? 2 : 1);
  custody.resolve({ run: f.run, snapshot: {} as never, executionCharged: true, runChanged: false });
  await close; expect(f.client.offer).toHaveBeenCalledTimes(operation === 'offer' ? 1 : 0);
  expect(f.gateway.close).not.toHaveBeenCalled();
});
it('close during positive observation retains custody and forbids cancellation', async () => {
  const f = fixture(); f.run.cancellationRequested = true; f.claim('replay'); f.client.snapshot.mockResolvedValue(positive());
  const pending = deferred<DispatchObservation>(); f.store.observe.mockReturnValue(pending.promise);
  const runtime = f.start(); await tick(); const close = runtime.close();
  pending.resolve({ run: f.run, snapshot: {} as never, executionCharged: true, runChanged: false });
  await close; expect(f.client.cancel).not.toHaveBeenCalled();
});
it('negative original during close retains uncertainty without synthetic observation', async () => {
  const f = fixture(); f.claim('replay'); const pending = deferred<ClientResult<AttemptSnapshot>>();
  f.client.snapshot.mockReturnValue(pending.promise); const runtime = f.start(); await tick();
  const close = runtime.close(); pending.resolve(missing()); await close;
  expect(f.client.offer).not.toHaveBeenCalled(); expect(f.store.observe).not.toHaveBeenCalled();
});
it('captures all client methods before snapshot awaits', async () => {
  const f = fixture(); f.claim('replay'); const pending = deferred<ClientResult<AttemptSnapshot>>();
  const originalOffer = f.client.offer; f.client.snapshot.mockReturnValue(pending.promise);
  const runtime = f.start(); await tick(); f.client.offer = vi.fn(); f.client.cancel = vi.fn();
  pending.resolve(missing()); await flush(); await runtime.close();
  expect(originalOffer).toHaveBeenCalledTimes(1); expect(f.client.offer).not.toHaveBeenCalled();
});

it.each(['offer', 'snapshot'] as const)('never overlaps an unsettled %s original with a replacement turn', async operation => {
  const f = fixture();
  if (operation === 'snapshot') f.claim('replay');
  const pending = deferred<ClientResult<AttemptSnapshot>>(); f.client[operation].mockReturnValue(pending.promise);
  const runtime = f.start(); await tick(5000);
  expect(f.store.scan).toHaveBeenCalledTimes(1); expect(f.store.readOffer).toHaveBeenCalledTimes(1);
  expect(f.client[operation]).toHaveBeenCalledTimes(1); expect(runtime.state().active).toBe(true);
  const close = runtime.close(); pending.resolve({ ok: false, error: { kind: 'cancelled' } }); await close;
});
it('uses the default250ms interval when omitted', async () => {
  const f = fixture(); const { intervalMs: _interval, ...options } = f.options;
  expect(_interval).toBe(25);
  const { startDeliveryRuntime } = await import('../../src/adapters/outbound/runner/delivery/index.js');
  const runtime = startDeliveryRuntime(options); await tick(249);
  expect(f.store.scan).toHaveBeenCalledTimes(1); await tick(1); expect(f.store.scan).toHaveBeenCalledTimes(2);
  await runtime.close();
});
