import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { deferred, fixture, flush, positive, tick } from './fixture.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
it.each(['scan', 'readOffer', 'claim', 'observe'] as const)('retains fatal %s failure and notifies exactly once', async operation => {
  const f = fixture(); const error = new Error('synthetic operation failure');
  f.store[operation].mockRejectedValue(error);
  const runtime = f.start(); await tick(1000);
  expect(runtime.state()).toEqual({ status: 'failed', active: false, reason: 'operation_failure' });
  expect(f.onFailure).toHaveBeenCalledExactlyOnceWith(error);
  const close = runtime.close(); expect(runtime.close()).toBe(close); await expect(close).rejects.toBe(error);
  await tick(1000); expect(f.onFailure).toHaveBeenCalledTimes(1);
});
it.each(['offer', 'snapshot', 'cancel', 'cancelOriginal'] as const)('makes local %s request construction failure fatal', async operation => {
  const f = fixture();
  if (operation !== 'offer') f.claim('replay');
  if (operation === 'cancelOriginal') f.run.cancellationRequested = true;
  if (operation === 'cancel') { f.run.cancellationRequested = true; f.client.snapshot.mockResolvedValue(positive()); }
  f.client[operation].mockResolvedValue({ ok: false, error: { kind: 'request' } });
  const runtime = f.start(); await tick(); await expect(runtime.close()).rejects.toThrow('Invalid delivery request');
  expect(f.onFailure).toHaveBeenCalledTimes(1);
});
it('awaits one failure callback and retains both operation and notification errors', async () => {
  const f = fixture(); const operation = new Error('operation'); const notification = new Error('notification');
  const pending = deferred<void>(); f.store.scan.mockRejectedValue(operation); f.onFailure.mockReturnValue(pending.promise);
  const runtime = f.start(); await tick(5000);
  expect(runtime.state()).toEqual({ status: 'failed', active: true, reason: 'operation_failure' });
  const close = runtime.close(); const observed = close.catch(error => error as AggregateError);
  let closed = false; void observed.then(() => { closed = true; }); await flush(); expect(closed).toBe(false);
  pending.reject(notification); const result = await observed;
  expect(result).toBeInstanceOf(AggregateError); if (!(result instanceof AggregateError)) throw new Error('Expected retained failures');
  expect(result.errors).toEqual([operation, notification]);
  expect(runtime.state().reason).toBe('failure_notification'); expect(f.onFailure).toHaveBeenCalledTimes(1);
  expect(runtime.close()).toBe(close); await expect(runtime.close()).rejects.toBe(result);
});
it('retains observation failure received during close and awaits failure callback', async () => {
  const f = fixture(); const pending = deferred<Awaited<ReturnType<typeof f.client.offer>>>();
  const operation = new Error('observe failure'); const notification = deferred<void>();
  f.client.offer.mockReturnValue(pending.promise); f.store.observe.mockRejectedValue(operation);
  f.onFailure.mockReturnValue(notification.promise);
  const runtime = f.start(); await tick(); const close = runtime.close(); const observed = close.catch(error => error);
  pending.resolve(positive()); await flush(); expect(f.onFailure).toHaveBeenCalledExactlyOnceWith(operation);
  notification.resolve(); expect(await observed).toBe(operation);
});
it('a rejected original HTTP call is fatal and is not replaced', async () => {
  const f = fixture(); const error = new Error('unexpected thrown adapter error'); f.client.offer.mockRejectedValue(error);
  const runtime = f.start(); await tick(5000); await expect(runtime.close()).rejects.toBe(error);
  expect(f.client.offer).toHaveBeenCalledTimes(1); expect(f.onFailure).toHaveBeenCalledTimes(1);
});
