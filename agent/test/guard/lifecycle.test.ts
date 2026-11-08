import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { OutputGuardService } from '../../src/guard/service.js';
import type { OutputWatch } from '../../src/guard/types.js';
import type { OutputScanResult } from '../../src/staging/index.js';
import { deferred, flush, known, request, setup } from './fixtures.js';

beforeEach(() => { vi.useFakeTimers(); vi.spyOn(performance, 'now').mockImplementation(() => Date.now()); vi.setSystemTime(0); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it('fences a reentrant clock close before issuing a scan', async () => {
  const fixture = setup(undefined, { monotonicNow: () => { void service?.close(); return 0; } });
  const service: OutputGuardService = fixture.service; const watch = service.watch(request()); await flush();
  expect(await watch.initial).toEqual({ ready: false }); expect(fixture.scan).not.toHaveBeenCalled(); await service.close();
});
it('owns scanner originals before reentrant watch close', async () => {
  const held = deferred<OutputScanResult>();
  const scan = vi.fn(() => { void watch.close(); return held.promise; });
  const { service } = setup(scan); const watch: OutputWatch = service.watch(request()); service.start(); await flush();
  expect(await watch.initial).toEqual({ ready: false }); let closed = false;
  const close = watch.close().then(() => { closed = true; }); await flush(); expect(closed).toBe(false);
  held.resolve(known()); await close; expect(watch.status().ready).toBe(false); await service.close();
});
it('owns stop originals before a reentrant close and waits for acknowledgement', async () => {
  const held = deferred<void>();
  const scan = vi.fn(async (): Promise<OutputScanResult> => ({ kind: 'limit', startedAt: 0, reason: 'output' }));
  const { service } = setup(scan, { stop: () => { void watch.close(); return held.promise; } });
  const watch: OutputWatch = service.watch(request()); service.start(); await flush(); let closed = false;
  const close = watch.close().then(() => { closed = true; }); await flush(); expect(closed).toBe(false);
  held.resolve(); await close; await service.close();
});
it('retains 64 uncertain registrations until held originals drain', async () => {
  const held = deferred<OutputScanResult>(); const { service } = setup(vi.fn(() => held.promise));
  const watches = Array.from({ length: 64 }, (_, index) => service.watch(request(index + 1)));
  service.start(); await flush(); const first = watches[0]!.close();
  expect(() => service.watch(request(65))).toThrow('capacity'); held.resolve(known()); await first;
  const next = service.watch(request(65)); await next.close(); await service.close();
});
it('does not inspect result getters or spin on rejected scanners', async () => {
  const getter = vi.fn(() => 'known'); const hostile = Object.defineProperty({}, 'kind', { get: getter });
  const scan = vi.fn(async () => hostile as OutputScanResult); const { service, stop } = setup(scan);
  const watch: OutputWatch = service.watch(request()); service.start(); await flush();
  expect(getter).not.toHaveBeenCalled(); expect(await watch.initial).toEqual({ ready: false });
  expect(stop).toHaveBeenCalledTimes(1); await service.close();
  const rejected = setup(vi.fn(async () => { throw new Error('io'); }));
  const unknown = rejected.service.watch(request()); rejected.service.start(); await flush();
  expect(await unknown.initial).toEqual({ ready: false }); expect(rejected.scan).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(49); expect(rejected.scan).toHaveBeenCalledTimes(1); await rejected.service.close();
});
it('rejects accessor inputs before observations', async () => {
  const { service, scan } = setup(); const getter = vi.fn(() => request().key);
  const input = Object.defineProperty(request(), 'key', { get: getter });
  expect(() => service.watch(input)).toThrow('invalid_input'); expect(getter).not.toHaveBeenCalled();
  expect(scan).not.toHaveBeenCalled(); await service.close();
});
it('does not refresh a successful sample with transient unknowns', async () => {
  const scan = vi.fn().mockResolvedValueOnce(known()).mockResolvedValue({ kind: 'unknown', reason: 'io' });
  const { service, stop } = setup(scan); const watch: OutputWatch = service.watch(request()); service.start(); await flush();
  expect(await watch.initial).toEqual({ ready: true }); await vi.advanceTimersByTimeAsync(200);
  expect(watch.status().lastKnownAt).toBe(0); expect(watch.status().ready).toBe(false);
  expect(stop).toHaveBeenCalledTimes(1); await service.close();
});
it('preserves late cleanup failure after close has fenced the watch', async () => {
  const held = deferred<OutputScanResult>(); const { service } = setup(vi.fn(() => held.promise));
  const watch: OutputWatch = service.watch(request()); service.start(); await flush(); const close = watch.close();
  held.resolve({ kind: 'unknown', reason: 'cleanup' }); await expect(close).rejects.toThrow('cleanup');
  await expect(service.close()).rejects.toThrow('cleanup'); expect(service.status().watched).toBe(1);
});
it('never accepts a known result after its sample deadline', async () => {
  const held = deferred<OutputScanResult>(); const { service } = setup(vi.fn(() => held.promise));
  const watch = service.watch(request()); service.start(); await flush(); await vi.advanceTimersByTimeAsync(100);
  held.resolve(known()); await flush(); expect(await watch.initial).toEqual({ ready: false });
  expect(watch.status().ready).toBe(false); await service.close();
});
it('fails closed when a clock callback reenters observation', async () => {
  const { service, stop } = setup(undefined, { monotonicNow: () => { service.status(); return 0; } });
  const watch = service.watch(request()); service.start(); await flush();
  expect(await watch.initial).toEqual({ ready: false }); expect(service.status().ready).toBe(false);
  expect(stop).toHaveBeenCalledTimes(1); await service.close();
});
