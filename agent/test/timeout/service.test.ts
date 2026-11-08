import { afterEach, expect, it, vi } from 'vitest';
import { createTimeoutGuard } from '../../src/timeout/index.js';
import type { TimeoutGuard, TimeoutRequest, TimeoutOptions } from '../../src/timeout/index.js';

const services: TimeoutGuard[] = [];
afterEach(async () => { await Promise.allSettled(services.splice(0).map(service => service.close())); vi.useRealTimers(); });
function setup(stop: TimeoutOptions['stop'] = async () => undefined) {
  vi.useFakeTimers();
  let wall = 1000; let mono = 100;
  const recorded = vi.fn(stop);
  const guard = createTimeoutGuard({ intervalMs: 10, wallNow: () => wall, monotonicNow: () => mono, stop: recorded });
  services.push(guard);
  const request = (id = 1): TimeoutRequest => ({
    key: { organizationId: '00000000-0000-4000-8000-000000000001', workspaceId: '00000000-0000-4000-8000-000000000002',
      attemptId: `00000000-0000-4000-8000-${id.toString().padStart(12, '0')}`, generation: 1 },
    admittedAt: 900, timeoutMs: 200, clockHighWater: 1000, clockFenced: false, sampledAt: 100,
  });
  return { guard, request, stop: recorded, time(w: number, m: number) { wall = w; mono = m; } };
}
it('requires start and expires at the durable deadline without a drive call', async () => {
  const f = setup(); const watch = f.guard.watch(f.request());
  expect(watch.status().ready).toBe(false); f.guard.start(); expect(watch.status().ready).toBe(true);
  f.time(1099, 199); await vi.advanceTimersByTimeAsync(10); expect(f.stop).not.toHaveBeenCalled();
  f.time(1100, 200); await vi.advanceTimersByTimeAsync(10);
  expect(f.stop).toHaveBeenCalledExactlyOnceWith(f.request().key, 'timeout');
  expect(watch.status()).toMatchObject({ ready: false, stopRequested: true, reason: 'timeout' });
});
it('charges metadata wait time and never renews a duplicate registration', async () => {
  const f = setup(); f.guard.start(); f.time(1000, 199);
  const watch = f.guard.watch(f.request()); expect(watch.status().ready).toBe(true);
  expect(f.guard.watch({ ...f.request(), sampledAt: 199 })).toBe(watch);
  f.time(1000, 200); await vi.advanceTimersByTimeAsync(10);
  expect(f.stop).toHaveBeenCalledExactlyOnceWith(f.request().key, 'timeout');
});
it('forward wall jumps shorten the budget even if monotonic time barely moves', async () => {
  const f = setup(); f.guard.start(); f.guard.watch(f.request()); f.time(1200, 101);
  await vi.advanceTimersByTimeAsync(10); expect(f.stop).toHaveBeenCalledExactlyOnceWith(f.request().key, 'timeout');
});
it.each(['wall', 'mono', 'invalid'] as const)('fences all watches on %s clock failure', async kind => {
  const f = setup(); f.guard.start(); const a = f.guard.watch(f.request()); f.guard.watch(f.request(2));
  f.time(kind === 'wall' ? 999 : 1000, kind === 'mono' ? 99 : kind === 'invalid' ? NaN : 100);
  await vi.advanceTimersByTimeAsync(10);
  expect(f.stop.mock.calls.map(call => call[1])).toEqual(['clock_integrity', 'clock_integrity']);
  expect(a.status().ready).toBe(false); expect(f.guard.status().ready).toBe(false);
});
it.each([
  { sampledAt: 101 }, { clockFenced: true }, { clockHighWater: 1001 },
  { admittedAt: 8_640_000_000_000_000, clockHighWater: 8_640_000_000_000_000, timeoutMs: 8_640_000_000_000_000 },
])('rejects unsafe clock anchors without granting readiness: %j', async amendment => {
  const f = setup(); f.guard.start(); const watch = f.guard.watch({ ...f.request(), ...amendment });
  await Promise.resolve(); expect(watch.status().reason).toBe('clock_integrity');
  expect(f.stop).toHaveBeenCalledExactlyOnceWith(f.request().key, 'clock_integrity');
});
it('retains held stops through cached close and issues no callbacks after close', async () => {
  let release!: () => void;
  const stop = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
  const f = setup(stop); f.guard.start(); const watch = f.guard.watch(f.request());
  f.time(1100, 200); await vi.advanceTimersByTimeAsync(10);
  let closed = false; const closing = f.guard.close(); expect(f.guard.close()).toBe(closing);
  void closing.then(() => { closed = true; }); await Promise.resolve(); expect(closed).toBe(false);
  f.time(900, 99); await vi.advanceTimersByTimeAsync(100); expect(stop).toHaveBeenCalledTimes(1);
  release(); await closing; expect(closed).toBe(true); expect(watch.status().closed).toBe(true);
});
it('escalates a held timeout once on rollback and drains both original stops', async () => {
  const releases: (() => void)[] = [];
  const stop = vi.fn(() => new Promise<void>(resolve => { releases.push(resolve); }));
  const f = setup(stop); f.guard.start(); f.guard.watch(f.request());
  f.time(1100, 200); await vi.advanceTimersByTimeAsync(10);
  f.time(1099, 201); await vi.advanceTimersByTimeAsync(10); await vi.advanceTimersByTimeAsync(100);
  expect(f.stop.mock.calls.map(call => call[1])).toEqual(['timeout', 'clock_integrity']);
  let closed = false; const closing = f.guard.close().then(() => { closed = true; });
  releases[1]!(); await Promise.resolve(); expect(closed).toBe(false); releases[0]!(); await closing;
});
it('retains failed registrations and refuses clean shutdown', async () => {
  const stop = vi.fn(async () => { throw new Error('synthetic stop rejected'); });
  const f = setup(stop); f.guard.start(); const watch = f.guard.watch(f.request());
  f.time(1100, 200); await vi.advanceTimersByTimeAsync(10);
  await expect(watch.close()).rejects.toMatchObject({ reason: 'cleanup' });
  expect(f.guard.status().watched).toBe(1); await expect(f.guard.close()).rejects.toMatchObject({ reason: 'cleanup' });
});
it('bounds uncertain owners to64, rejects conflicts and reuses only closed slots', async () => {
  const f = setup(); f.guard.start(); const watches = Array.from({ length: 64 }, (_, i) => f.guard.watch(f.request(i + 1)));
  expect(() => f.guard.watch(f.request(65))).toThrow('capacity');
  expect(() => f.guard.watch({ ...f.request(), timeoutMs: 201 })).toThrow('conflict');
  await watches[0]!.close(); const replacement = f.guard.watch(f.request(65)); expect(replacement.status().ready).toBe(true);
  await replacement.close();
  for (let i = 100; i < 170; i++) { const watch = f.guard.watch(f.request(i)); await watch.close(); }
});
it('captures only fixed own data fields without enumerating unrelated getters', async () => {
  const f = setup(); f.guard.start(); const input = f.request();
  for (let i = 0; i < 1000; i++) Object.defineProperty(input, `extra${i}`, { get: () => { throw new Error('must not observe'); } });
  expect(f.guard.watch(input).status().ready).toBe(true);
  Object.defineProperty(input, 'timeoutMs', { get: () => 200 });
  expect(() => f.guard.watch(input)).toThrow('invalid_input');
});
it('adopts a watch when the clock callback reenters service close', async () => {
  let reenter = false;
  const guard: TimeoutGuard = createTimeoutGuard({ wallNow: () => { if (reenter) void guard.close(); return 1000; }, monotonicNow: () => 100,
    stop: async () => { throw new Error('late stop'); } }); services.push(guard); guard.start(); reenter = true;
  const f = setup(); const watch = guard.watch(f.request());
  expect(watch.status().ready).toBe(false); await guard.close(); expect(watch.status().closed).toBe(true);
});
