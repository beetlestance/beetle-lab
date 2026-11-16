import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuardError } from '../../src/guard/types.js';
import type { OutputScanResult } from '../../src/staging/index.js';
import { deferred, flush, known, request, setup } from './fixtures.js';

beforeEach(() => { vi.useFakeTimers(); vi.spyOn(performance, 'now').mockImplementation(() => Date.now()); vi.setSystemTime(0); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe('output guard service', () => {
  it('requires start and a complete initial scan', async () => {
    const { service, scan } = setup(); const watch = service.watch(request());
    expect(service.status().ready).toBe(false); expect(scan).not.toHaveBeenCalled();
    service.start(); await flush(); expect(await watch.initial).toEqual({ ready: true });
    expect(service.status().ready).toBe(true); await service.close();
    expect(watch.status().ready).toBe(false);
  });
  it('fills two slots and pumps all 64 watches without interval delay', async () => {
    const first = deferred<OutputScanResult>(); const second = deferred<OutputScanResult>();
    const scan = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
      .mockImplementation(async () => known());
    const { service } = setup(scan); const watches = Array.from({ length: 64 }, (_, index) => service.watch(request(index + 1)));
    expect(() => service.watch(request(65))).toThrow(GuardError);
    service.start(); await flush(); expect(scan).toHaveBeenCalledTimes(2);
    first.resolve(known()); await flush(); expect(scan).toHaveBeenCalledTimes(64);
    second.resolve(known()); await flush(); expect((await Promise.all(watches.map(watch => watch.initial))).every(value => value.ready)).toBe(true);
    await service.close();
  });
  it('expires initial readiness independently of held scans and drains originals', async () => {
    const held = deferred<OutputScanResult>(); const { service, stop } = setup(vi.fn(() => held.promise));
    service.start(); const watch = service.watch(request()); await flush();
    await vi.advanceTimersByTimeAsync(200); expect(await watch.initial).toEqual({ ready: false });
    expect(stop).toHaveBeenCalledTimes(1); expect(watch.status().ready).toBe(false);
    let closed = false; const close = watch.close().then(() => { closed = true; }); await flush(); expect(closed).toBe(false);
    held.resolve(known()); await close; expect(watch.status().ready).toBe(false);
    expect(service.status().watched).toBe(0); await service.close();
  });
  it('backs off busy and unknown without renewing freshness', async () => {
    const scan = vi.fn(async (): Promise<OutputScanResult> => ({ kind: 'unknown', reason: 'busy' }));
    const { service, stop } = setup(scan); service.start(); const watch = service.watch(request()); await flush();
    expect(scan).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(49); expect(scan).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(151); expect(await watch.initial).toEqual({ ready: false });
    expect(stop).toHaveBeenCalledTimes(1); await service.close();
  });
  it('broadcasts disk limits and stops each watch once', async () => {
    const scan = vi.fn(async (): Promise<OutputScanResult> => ({ kind: 'limit', startedAt: 0, reason: 'disk' }));
    const { service, stop } = setup(scan); const watches = [service.watch(request()), service.watch(request(2))];
    service.start(); await flush(); expect(stop).toHaveBeenCalledTimes(2);
    expect(await Promise.all(watches.map(watch => watch.initial))).toEqual([{ ready: false }, { ready: false }]);
    await vi.advanceTimersByTimeAsync(1000); expect(stop).toHaveBeenCalledTimes(2); await service.close();
  });
  it('isolates per-watch output limits', async () => {
    const scan = vi.fn().mockResolvedValueOnce({ kind: 'limit', startedAt: 0, reason: 'output' }).mockResolvedValue(known());
    const { service, stop } = setup(scan); const a = service.watch(request()); const b = service.watch(request(2));
    service.start(); await flush(); expect(await a.initial).toEqual({ ready: false }); expect(await b.initial).toEqual({ ready: true });
    expect(stop).toHaveBeenCalledTimes(1); await service.close();
  });
  it('rejects duplicates with conflicting budgets and recycles retired capacity', async () => {
    const { service } = setup(); const input = request(); const watch = service.watch(input);
    expect(service.watch(input)).toBe(watch); expect(() => service.watch({ ...input, outputBytes: 1 })).toThrow(GuardError);
    await watch.close();
    for (let index = 1; index <= 70; index++) await service.watch(request(index)).close();
    expect(service.status().watched).toBe(0); await service.close();
  });
  it('rejects future samples and revokes readiness on clock rollback', async () => {
    let now = 100; const scan = vi.fn(async () => known(101)); const { service, stop } = setup(scan, { monotonicNow: () => now });
    const watch = service.watch(request()); service.start(); await flush(); expect(watch.status().ready).toBe(false);
    now = 99; expect(service.status().ready).toBe(false); await flush(); expect(stop).toHaveBeenCalledTimes(1);
    expect(await watch.initial).toEqual({ ready: false }); await service.close();
  });
  it('retains cleanup failures and rejected stop originals', async () => {
    const scan = vi.fn(async (): Promise<OutputScanResult> => ({ kind: 'unknown', reason: 'cleanup' }));
    const { service } = setup(scan, { stop: async () => { throw new Error('stop failed'); } });
    const watch = service.watch(request()); service.start(); await flush();
    const close = watch.close(); expect(watch.close()).toBe(close); await expect(close).rejects.toThrow('cleanup');
    expect(service.status().watched).toBe(1); const shutdown = service.close(); expect(service.close()).toBe(shutdown);
    await expect(shutdown).rejects.toThrow('cleanup');
  });
  it('drains other scans despite one failed close', async () => {
    const held = deferred<OutputScanResult>(); const scan = vi.fn().mockResolvedValueOnce({ kind: 'unknown', reason: 'cleanup' })
      .mockImplementation(() => held.promise);
    const { service } = setup(scan); service.watch(request()); service.watch(request(2)); service.start(); await flush();
    let settled = false; const close = service.close().catch(() => { settled = true; }); await flush(); expect(settled).toBe(false);
    held.resolve(known()); await close; expect(settled).toBe(true);
  });
});
