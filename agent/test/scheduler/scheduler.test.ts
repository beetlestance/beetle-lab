import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScheduler } from '../../src/scheduler/index.js';
import type { Scheduler, SchedulerOptions } from '../../src/scheduler/index.js';
import type { GenerationKey, RunnablePage } from '../../src/journal/index.js';
import type { DriveProgress } from '../../src/installation/index.js';

function key(id: number): GenerationKey {
  return { organizationId: '00000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-000000000002',
    attemptId: `00000000-0000-4000-8000-${id.toString().padStart(12, '0')}`, generation: 1 };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const released: DriveProgress = { kind: 'released', collection: 'finished' };
const loops: Scheduler[] = [];
const releases: (() => void)[] = [];
function fixture(overrides: Partial<SchedulerOptions> = {}) {
  vi.useFakeTimers();
  const scanRunnable = vi.fn<SchedulerOptions['journal']['scanRunnable']>().mockResolvedValue({ attempts: [] });
  const drive = vi.fn<SchedulerOptions['installation']['drive']>().mockResolvedValue(released);
  const loop = createScheduler({ journal: { scanRunnable }, installation: { drive },
    intervalMs: 50, operationTimeoutMs: 100, monotonicNow: () => 1000, ...overrides });
  loops.push(loop);
  return { loop, scanRunnable, drive };
}
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await Promise.all(loops.splice(0).map(loop => loop.close()));
  vi.useRealTimers();
});

describe('bounded installation scheduling', () => {
  it('starts once and discovers charged before queued without owning lifecycle outcomes', async () => {
    const { loop, scanRunnable, drive } = fixture();
    scanRunnable.mockImplementation(async page => ({ attempts: [key(page.lane === 'charged' ? 1 : 2)] }));
    loop.start(); loop.start(); await vi.advanceTimersByTimeAsync(0);
    expect(scanRunnable.mock.calls.map(([page]) => page.lane)).toEqual(['charged', 'queued']);
    expect(drive.mock.calls.map(([scope]) => scope)).toEqual([key(1), key(2)]);
    expect(drive.mock.calls[0]?.[1]).toMatchObject({ deadline: 1100, signal: expect.any(AbortSignal) });
    expect(loop.status()).toEqual({ running: true, closed: false, outstanding: 0, lastError: null });
  });

  it('retains64 blocked originals after deadline abort and never drives a duplicate key', async () => {
    const { loop, scanRunnable, drive } = fixture();
    const held = deferred<DriveProgress>(); releases.push(() => held.resolve(released));
    drive.mockReturnValue(held.promise);
    scanRunnable.mockImplementation(async page => ({ attempts: page.lane === 'queued'
      ? Array.from({ length: page.limit }, (_, id) => key(id + 2)) : [key(1)] }));
    loop.start(); await vi.advanceTimersByTimeAsync(0);
    expect(drive).toHaveBeenCalledTimes(64);
    await vi.advanceTimersByTimeAsync(250);
    expect(drive).toHaveBeenCalledTimes(64);
    expect(loop.status().outstanding).toBe(64);
    expect(drive.mock.calls.every(([, operation]) => operation.signal?.aborted)).toBe(true);
    const closing = loop.close(); let closed = false; void closing.then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false);
    held.resolve(released); await closing;
    expect(loop.status()).toMatchObject({ closed: true, running: false, outstanding: 0 });
  });

  it('advances queued pages and restarts at zero, rechecking charged on every pass', async () => {
    const { loop, scanRunnable, drive } = fixture();
    scanRunnable.mockImplementation(async page => {
      if (page.lane === 'charged') return { attempts: [] };
      return page.cursor === undefined ? { attempts: [key(1)], cursor: 7 } : { attempts: [key(2)] };
    });
    loop.start(); await vi.advanceTimersByTimeAsync(100);
    expect(scanRunnable.mock.calls.map(([page]) => page)).toEqual([
      { lane: 'charged', limit: 100 }, { lane: 'queued', limit: 64 },
      { lane: 'charged', limit: 100 }, { lane: 'queued', limit: 64, cursor: 7 },
      { lane: 'charged', limit: 100 }, { lane: 'queued', limit: 64 },
    ]);
    expect(drive.mock.calls.map(([scope]) => scope.attemptId)).toEqual([key(1).attemptId, key(2).attemptId, key(1).attemptId]);
  });

  it('does not dispatch queued work when charged discovery fails or exceeds its durable bound', async () => {
    const { loop, scanRunnable, drive } = fixture();
    scanRunnable.mockRejectedValueOnce(new Error('synthetic'));
    scanRunnable.mockResolvedValue({ attempts: [key(1)], cursor: 1 });
    loop.start(); await vi.advanceTimersByTimeAsync(50);
    expect(scanRunnable.mock.calls.every(([page]) => page.lane === 'charged')).toBe(true);
    expect(drive).not.toHaveBeenCalled(); expect(loop.status().lastError).toBe('scan');
  });

  it('considers all100 deferred queued identities instead of starving the last36', async () => {
    const { loop, scanRunnable, drive } = fixture();
    const queued = Array.from({ length: 100 }, (_, index) => key(index + 1));
    drive.mockResolvedValue({ kind: 'deferred', reason: 'budget_unavailable' });
    scanRunnable.mockImplementation(async page => {
      if (page.lane === 'charged') return { attempts: [] };
      const offset = page.cursor ?? 0; const end = offset + page.limit;
      return { attempts: queued.slice(offset, end), ...(end < queued.length ? { cursor: end } : {}) };
    });
    loop.start(); await vi.advanceTimersByTimeAsync(50);
    expect(new Set(drive.mock.calls.map(([scope]) => scope.attemptId)).size).toBe(100);
    expect(drive.mock.calls.at(-1)?.[0]).toEqual(key(100));
    expect(loop.status()).toMatchObject({ outstanding: 0, lastError: null });
  });

  it('retains original scan on close and prevents late discovery from dispatching', async () => {
    const { loop, scanRunnable, drive } = fixture();
    const held = deferred<RunnablePage>(); releases.push(() => held.resolve({ attempts: [] }));
    scanRunnable.mockReturnValue(held.promise);
    loop.start(); await vi.advanceTimersByTimeAsync(0);
    const closing = loop.close(); let closed = false; void closing.then(() => { closed = true; });
    await vi.advanceTimersByTimeAsync(1000);
    expect(closed).toBe(false); expect(scanRunnable).toHaveBeenCalledTimes(1);
    held.resolve({ attempts: [key(1)] }); await closing;
    expect(drive).not.toHaveBeenCalled(); expect(loop.close()).toBe(closing);
    expect(() => loop.start()).toThrow('closed');
  });

  it('records synchronous drive failure and reconciles on the next pass', async () => {
    const { loop, scanRunnable, drive } = fixture();
    scanRunnable.mockImplementation(async page => ({ attempts: page.lane === 'charged' ? [key(1)] : [] }));
    drive.mockImplementationOnce(() => { throw new Error('synthetic'); });
    loop.start(); await vi.advanceTimersByTimeAsync(50);
    expect(drive).toHaveBeenCalledTimes(2); expect(loop.status().lastError).toBe('drive');
    expect(loop.status().outstanding).toBe(0);
  });

  it('reserves the original discovery promise before a port can reenter close', async () => {
    const { loop, scanRunnable, drive } = fixture();
    const held = deferred<RunnablePage>(); releases.push(() => held.resolve({ attempts: [] }));
    let closing: Promise<void> | undefined; let closed = false;
    scanRunnable.mockImplementation(() => {
      closing = loop.close(); void closing.then(() => { closed = true; }); return held.promise;
    });
    loop.start(); await vi.advanceTimersByTimeAsync(0);
    expect(closing).toBeDefined(); expect(closed).toBe(false);
    held.resolve({ attempts: [key(1)] }); await closing;
    expect(closed).toBe(true); expect(drive).not.toHaveBeenCalled();
  });

  it('caches shutdown before invoking synchronous abort listeners', async () => {
    const { loop, scanRunnable, drive } = fixture();
    const held = deferred<DriveProgress>(); releases.push(() => held.resolve(released));
    let reentrant: Promise<void> | undefined;
    scanRunnable.mockImplementation(async page => ({ attempts: page.lane === 'charged' ? [key(1)] : [] }));
    drive.mockImplementation((_key, operation) => {
      operation.signal?.addEventListener('abort', () => { reentrant = loop.close(); }); return held.promise;
    });
    loop.start(); await vi.advanceTimersByTimeAsync(0);
    const closing = loop.close(); expect(reentrant).toBe(closing);
    held.resolve(released); await closing;
    expect(loop.status().outstanding).toBe(0);
  });

  it('does not invent deadlines when the trusted clock fails', async () => {
    const { loop, scanRunnable, drive } = fixture({ monotonicNow: () => Number.NaN });
    scanRunnable.mockResolvedValue({ attempts: [key(1)] });
    loop.start(); await vi.advanceTimersByTimeAsync(0);
    expect(drive).not.toHaveBeenCalled(); expect(loop.status().lastError).toBe('clock');
  });

  it.each([1, 31, 32])('fairly services64 charged identities through a port capacity of%i', async capacity => {
    const { loop, scanRunnable, drive } = fixture();
    const attempts = Array.from({ length: 64 }, (_, index) => key(index + 1));
    const serviced = new Set<string>(); let active = 0;
    scanRunnable.mockImplementation(async page => ({ attempts: page.lane === 'charged' ? attempts : [] }));
    drive.mockImplementation(async scope => {
      if (active >= capacity) throw new Error('synthetic queue_full');
      active++; serviced.add(scope.attemptId);
      await Promise.resolve(); active--; return released;
    });
    loop.start(); await vi.advanceTimersByTimeAsync(63 * 50);
    expect(serviced.size).toBe(64); expect(serviced.has(key(64).attemptId)).toBe(true);
    expect(loop.status().outstanding).toBe(0);
  });

  it.each([{ intervalMs: 49 }, { intervalMs: 5001 }, { operationTimeoutMs: 99 }, { operationTimeoutMs: Infinity }])(
    'rejects invalid timing %j', options => { expect(() => fixture(options)).toThrow('invalid_input'); });
});
