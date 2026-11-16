import { expect, it, vi } from 'vitest';
import type { DriveProgress } from '../../src/installation/index.js';
import type { RunnablePage } from '../../src/journal/index.js';
import { deferred, empty, fixture, key, released, releases } from './fixtures.js';

it.each([1, 31, 32])('services delivery and queued debt alongside64 charged attempts at port capacity%i', async capacity => {
  const { loop, scanRunnable, drive } = fixture();
  const charged = Array.from({ length: 64 }, (_, index) => key(index + 1));
  const serviced = new Set<string>(); let active = 0; let peak = 0;
  scanRunnable.mockImplementation(async page => {
    if (page.lane === 'charged') return { attempts: charged };
    if (page.lane === 'delivery') return { attempts: [key(65)], through: 65 };
    return { attempts: [key(66)] };
  });
  drive.mockImplementation(async scope => {
    peak = Math.max(peak, loop.status().outstanding);
    if (active >= capacity) throw new Error('synthetic queue_full');
    active++; serviced.add(scope.attemptId);
    await Promise.resolve(); active--; return { kind: 'deferred', reason: 'budget_unavailable' };
  });
  loop.start(); await vi.advanceTimersByTimeAsync(63 * 50);
  expect(serviced.size).toBe(66); expect(serviced.has(key(65).attemptId) && serviced.has(key(66).attemptId)).toBe(true);
  expect(peak).toBeLessThanOrEqual(64); expect(loop.status().outstanding).toBe(0);
  for (const [page] of scanRunnable.mock.calls) if (page.lane !== 'charged') expect(page.limit).toBeLessThanOrEqual(32);
});

it('pins finite delivery passes amid new arrivals and keeps queued positions independent', async () => {
  const { loop, scanRunnable, drive } = fixture();
  let pending = Array.from({ length: 70 }, (_, index) => index + 1); const considered: number[] = [];
  scanRunnable.mockImplementation(async page => {
    if (page.lane === 'charged') return empty(page);
    if (page.lane === 'queued') return page.cursor === undefined ? { attempts: [key(1001)], cursor: 701 } : { attempts: [key(1002)] };
    const through = page.through ?? Math.max(0, ...pending);
    const eligible = pending.filter(id => id > (page.cursor ?? 0) && id <= through);
    const rows = eligible.slice(0, page.limit);
    return { attempts: rows.map(key), through, ...(eligible.length > page.limit ? { cursor: rows.at(-1)! } : {}) };
  });
  drive.mockImplementation(async scope => {
    const id = pending.find(id => key(id).attemptId === scope.attemptId);
    if (id !== undefined) { considered.push(id); pending = pending.filter(value => value !== id); }
    return released;
  });
  loop.start(); await vi.advanceTimersByTimeAsync(0); pending.push(...Array.from({ length: 70 }, (_, index) => index + 71));
  await vi.advanceTimersByTimeAsync(50); pending.push(...Array.from({ length: 70 }, (_, index) => index + 141));
  await vi.advanceTimersByTimeAsync(50);
  expect(considered).toEqual(Array.from({ length: 70 }, (_, index) => index + 1));
  await vi.advanceTimersByTimeAsync(50);
  const deliveries = scanRunnable.mock.calls.map(([page]) => page).filter(page => page.lane === 'delivery');
  expect(deliveries.slice(0, 4)).toEqual([{ lane: 'delivery', limit: 32 },
    { lane: 'delivery', limit: 32, cursor: 32, through: 70 }, { lane: 'delivery', limit: 32, cursor: 64, through: 70 },
    { lane: 'delivery', limit: 32 }]);
  expect(considered[70]).toBe(71);
  const queued = scanRunnable.mock.calls.map(([page]) => page).filter(page => page.lane === 'queued');
  expect(queued.map(page => page.cursor)).toEqual([undefined, 701, undefined, 701]);
  expect(queued.every(page => page.through === undefined)).toBe(true);
});

it('retains expired64-slot custody when admission shrinks and does not consume unseen delivery pages', async () => {
  const { loop, scanRunnable, drive } = fixture(); const held = deferred<DriveProgress>(); releases.push(() => held.resolve(released));
  const charged = Array.from({ length: 64 }, (_, index) => key(index + 1));
  let capacity = 64; let active = 0; let drained = false;
  scanRunnable.mockImplementation(async page => {
    if (page.lane === 'charged') return { attempts: drained ? [] : charged };
    if (page.lane === 'delivery') return { attempts: [key(65)], through: 65 };
    return empty(page);
  });
  drive.mockImplementation(async scope => {
    if (active >= capacity) throw new Error('synthetic lowered admission capacity');
    active++;
    try { return scope.attemptId === key(65).attemptId ? released : await held.promise; }
    finally { active--; }
  });
  loop.start(); await vi.advanceTimersByTimeAsync(0); capacity = 1;
  await vi.advanceTimersByTimeAsync(250);
  expect(loop.status().outstanding).toBe(64); expect(active).toBe(64); expect(drive).toHaveBeenCalledTimes(64);
  expect(drive.mock.calls.every(([, operation]) => operation.signal?.aborted)).toBe(true);
  expect(scanRunnable).toHaveBeenCalledTimes(1);
  drained = true; held.resolve(released); await vi.advanceTimersByTimeAsync(0);
  expect(loop.status().outstanding).toBe(0); await vi.advanceTimersByTimeAsync(150);
  const delivery = scanRunnable.mock.calls.map(([page]) => page).find(page => page.lane === 'delivery');
  expect(delivery).toEqual({ lane: 'delivery', limit: 32 });
  expect(drive.mock.calls.some(([scope]) => scope.attemptId === key(65).attemptId)).toBe(true);
  expect(loop.status().outstanding).toBe(0);
});

it('drains an original held delivery scan on shutdown without dispatching its late page', async () => {
  const { loop, scanRunnable, drive } = fixture(); const held = deferred<RunnablePage>();
  releases.push(() => held.resolve({ attempts: [], through: 0 }));
  scanRunnable.mockImplementation(async page => page.lane === 'delivery' ? held.promise : empty(page));
  loop.start(); await vi.advanceTimersByTimeAsync(0); const closing = loop.close(); let closed = false;
  void closing.then(() => { closed = true; }); await vi.advanceTimersByTimeAsync(1000);
  expect(closed).toBe(false); expect(scanRunnable).toHaveBeenCalledTimes(2); expect(drive).not.toHaveBeenCalled();
  held.resolve({ attempts: [key(1)], cursor: 1, through: 2 }); await closing;
  expect(closed).toBe(true); expect(drive).not.toHaveBeenCalled(); expect(loop.close()).toBe(closing);
});

it('keeps shutdown pending for both the original delivery scan and original drive', async () => {
  const { loop, scanRunnable, drive } = fixture();
  const scan = deferred<RunnablePage>(); const work = deferred<DriveProgress>();
  releases.push(() => { scan.resolve({ attempts: [], through: 0 }); work.resolve(released); });
  scanRunnable.mockImplementation(async page => page.lane === 'charged' ? { attempts: [key(1)] }
    : page.lane === 'delivery' ? scan.promise : empty(page));
  drive.mockReturnValue(work.promise); loop.start(); await vi.advanceTimersByTimeAsync(0);
  const closing = loop.close(); let closed = false; void closing.then(() => { closed = true; });
  expect(drive.mock.calls[0]![1].signal?.aborted).toBe(true);
  scan.resolve({ attempts: [key(2)], through: 2 }); await vi.advanceTimersByTimeAsync(0);
  expect(closed).toBe(false); expect(loop.status().outstanding).toBe(1); expect(drive).toHaveBeenCalledTimes(1);
  work.resolve(released); await closing;
  expect(closed).toBe(true); expect(loop.status().outstanding).toBe(0); expect(scanRunnable).toHaveBeenCalledTimes(2);
});

it('preserves independent positions across a refused delivery page and retries the same finite upper', async () => {
  const { loop, scanRunnable, drive } = fixture(); let reads = 0;
  scanRunnable.mockImplementation(async page => {
    if (page.lane === 'charged') return empty(page);
    if (page.lane === 'queued') return page.cursor === undefined ? { attempts: [key(1001)], cursor: 701 } : { attempts: [key(1002)] };
    reads++;
    if (reads === 1) return { attempts: [key(1)], cursor: 40, through: 100 };
    if (reads === 2) throw new Error('synthetic Journal saturation');
    return { attempts: [key(2)], through: 100 };
  });
  loop.start(); await vi.advanceTimersByTimeAsync(100);
  const deliveries = scanRunnable.mock.calls.map(([page]) => page).filter(page => page.lane === 'delivery');
  expect(deliveries).toEqual([{ lane: 'delivery', limit: 32 }, { lane: 'delivery', limit: 32, cursor: 40, through: 100 },
    { lane: 'delivery', limit: 32, cursor: 40, through: 100 }]);
  const queued = scanRunnable.mock.calls.map(([page]) => page).filter(page => page.lane === 'queued');
  expect(queued.map(page => page.cursor)).toEqual([undefined, 701]);
  expect(drive.mock.calls.map(([scope]) => scope.attemptId)).toEqual([key(1), key(1001), key(1002), key(2)].map(scope => scope.attemptId));
  expect(loop.status().lastError).toBe('scan');
});

const malformed: { name: string; page: RunnablePage }[] = [
  { name: 'missing upper', page: { attempts: [key(1)] } },
  { name: 'negative upper', page: { attempts: [key(1)], through: -1 } },
  { name: 'unsafe upper', page: { attempts: [key(1)], through: Number.MAX_SAFE_INTEGER + 1 } },
  { name: 'zero upper with an identity', page: { attempts: [key(1)], through: 0 } },
  { name: 'cursor beyond upper', page: { attempts: [key(1)], cursor: 2, through: 1 } },
  { name: 'empty continuation', page: { attempts: [], cursor: 1, through: 2 } },
  { name: 'oversized page', page: { attempts: Array.from({ length: 33 }, (_, index) => key(index + 1)), through: 33 } },
  { name: 'malformed late identity', page: { attempts: [key(1), { ...key(2), attemptId: 'invalid' }], cursor: 2, through: 3 } },
  { name: 'sparse late identity', page: { attempts: Object.assign(Array<ReturnType<typeof key>>(2), { 0: key(1) }), through: 3 } },
];
it.each(malformed)('rejects $name without partial dispatch or cursor consumption', async ({ page: bad }) => {
  const { loop, scanRunnable, drive } = fixture(); let deliveryReads = 0;
  scanRunnable.mockImplementation(async page => {
    if (page.lane !== 'delivery') return empty(page);
    return ++deliveryReads === 1 ? bad : { attempts: [key(3)], through: 3 };
  });
  loop.start(); await vi.advanceTimersByTimeAsync(0);
  expect(drive).not.toHaveBeenCalled(); expect(loop.status().lastError).toBe('scan');
  await vi.advanceTimersByTimeAsync(50);
  const requests = scanRunnable.mock.calls.map(([page]) => page).filter(page => page.lane === 'delivery');
  expect(requests).toEqual([{ lane: 'delivery', limit: 32 }, { lane: 'delivery', limit: 32 }]);
  expect(drive.mock.calls[0]![0]).toEqual(key(3));
});

it('refuses a changed pinned upper without advancing its continuation', async () => {
  const { loop, scanRunnable, drive } = fixture(); let reads = 0;
  scanRunnable.mockImplementation(async page => {
    if (page.lane !== 'delivery') return empty(page);
    reads++;
    if (reads === 1) return { attempts: [key(1)], cursor: 3, through: 10 };
    return { attempts: [key(2)], through: reads === 2 ? 11 : 10 };
  });
  loop.start(); await vi.advanceTimersByTimeAsync(100);
  expect(scanRunnable.mock.calls.map(([page]) => page).filter(page => page.lane === 'delivery')).toEqual([
    { lane: 'delivery', limit: 32 }, { lane: 'delivery', limit: 32, cursor: 3, through: 10 },
    { lane: 'delivery', limit: 32, cursor: 3, through: 10 }]);
  expect(drive.mock.calls.map(([scope]) => scope.attemptId)).toEqual([key(1).attemptId, key(2).attemptId]);
});

it('shares the original map across lanes and bounds each noncharged request by remaining slots', async () => {
  const { loop, scanRunnable, drive } = fixture(); const held = deferred<DriveProgress>(); releases.push(() => held.resolve(released));
  const charged = Array.from({ length: 63 }, (_, index) => key(index + 1));
  scanRunnable.mockImplementation(async page => page.lane === 'charged' ? { attempts: charged }
    : page.lane === 'delivery' ? { attempts: [key(64)], through: 64 } : empty(page));
  drive.mockReturnValue(held.promise); loop.start(); await vi.advanceTimersByTimeAsync(0);
  expect(scanRunnable.mock.calls.map(([page]) => page)).toEqual([{ lane: 'charged', limit: 100 }, { lane: 'delivery', limit: 1 }]);
  expect(drive).toHaveBeenCalledTimes(64); expect(loop.status().outstanding).toBe(64);
});

it('keeps duplicate lane identities single-owned and captures their scoped keys', async () => {
  const { loop, scanRunnable, drive } = fixture(); const held = deferred<DriveProgress>(); releases.push(() => held.resolve(released));
  const original = key(1);
  scanRunnable.mockImplementation(async page => ({ attempts: [original], ...(page.lane === 'delivery' ? { through: 1 } : {}) }));
  drive.mockReturnValue(held.promise); loop.start(); await vi.advanceTimersByTimeAsync(100);
  expect(drive).toHaveBeenCalledTimes(1); expect(drive.mock.calls[0]![0]).not.toBe(original);
  expect(Object.isFrozen(drive.mock.calls[0]![0])).toBe(true); expect(loop.status().outstanding).toBe(1);
});
