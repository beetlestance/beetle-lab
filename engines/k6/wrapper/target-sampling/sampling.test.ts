import { afterEach, describe, expect, it, vi } from 'vitest';
import { startTargetSampling } from './index.js';
import type { TargetSamplingOptions } from './index.js';

const config = { path: '/metrics', intervalMs: 1000, timeoutMs: 100, cooldownMs: 2500 };
const signal = () => new AbortController().signal;
function options(fetch: typeof globalThis.fetch, overrides: Partial<TargetSamplingOptions> = {}): TargetSamplingOptions {
  return { target: 'http://synthetic.invalid/base', config, signal: signal(), fetch, ...overrides };
}
function json(value: unknown): Response { return new Response(JSON.stringify(value)); }
afterEach(() => vi.useRealTimers());

describe('target sampling observations', () => {
  it('keeps fixed finite numeric fields and missing values unknown, with frozen results', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ rss: 42, heapAlloc: -1,
      external: '5', cpuPercent: null, cppHeap: { used_size: 7 }, eventLoopDelay: { p99: 8 },
      gc: { count: 3 }, secretCanary: 'never retain', uptime: 0 }));
    const owner = await startTargetSampling(options(fetch, { config: { ...config, cooldownMs: 0 } }));
    const report = await owner.finish();
    const sample = report.samples[0]!;
    expect(sample).toMatchObject({ phase: 'before', status: 'ready', reason: null,
      values: { rss: 42, heapAlloc: null, external: null, cpuPercent: null,
        'cppHeap.used_size': 7, 'eventLoopDelay.p99': 8, 'gc.count': 3, uptime: 0 } });
    expect(Object.keys(sample.values)).toHaveLength(32);
    expect(JSON.stringify(report)).not.toContain('never retain');
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.samples)).toBe(true);
    expect(Object.isFrozen(sample.values)).toBe(true);
    expect(fetch).toHaveBeenCalledWith(new URL('http://synthetic.invalid/base/metrics'),
      expect.objectContaining({ redirect: 'error', credentials: 'omit', method: 'GET' }));
    expect(owner.finish()).toBe(owner.finish());
    expect(owner.close()).toBe(owner.close());
    await owner.close();
  });

  it.each([
    ['http', () => new Response('sensitive', { status: 503 })],
    ['invalid_json', () => new Response('{secret malformed')],
    ['invalid_json', () => json([])],
    ['invalid_json', () => new Response(new Uint8Array([255]))],
    ['body_limit', () => new Response('x'.repeat(65537))],
  ] as const)('reports %s without retaining response bodies', async (reason, response) => {
    const owner = await startTargetSampling(options(async () => response()));
    await owner.close();
    const report = await owner.finish();
    expect(report.samples[0]).toMatchObject({ status: 'unavailable', reason });
    expect(Object.values(report.samples[0]!.values).every(value => value === null)).toBe(true);
    expect(report.missed).toBe(1);
  });

  it('accepts an exactly 64KiB incrementally read body and cancels a chunked overflow', async () => {
    const exact = `{"rss":7}${' '.repeat(65536 - 9)}`;
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode(exact));
      controller.enqueue(new Uint8Array(1));
    }, cancel });
    const good = await startTargetSampling(options(async () => new Response(exact)));
    await good.close();
    expect((await good.finish()).samples[0]!.values.rss).toBe(7);
    const bad = await startTargetSampling(options(async () => new Response(stream)));
    await bad.close();
    expect((await bad.finish()).samples[0]!.reason).toBe('body_limit');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('maps rejected redirect/error transports to fixed transport reason', async () => {
    const owner = await startTargetSampling(options(async () => { throw new Error('secret URL/header'); }));
    await owner.close();
    const report = await owner.finish();
    expect(report.samples[0]!.reason).toBe('transport');
    expect(JSON.stringify(report)).not.toContain('secret');
  });
});

describe('target sampling ownership and bounds', () => {
  it('takes a baseline then sequential during and cooldown samples; finish drains all timers', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ rss: 1 }));
    const owner = await startTargetSampling(options(fetch));
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    const result = owner.finish();
    await vi.advanceTimersByTimeAsync(2500);
    const report = await result;
    expect(report.samples.map(sample => sample.phase)).toEqual(['before', 'during', 'during', 'after', 'after', 'after']);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it('waits for original aborted fetch completion before returning baseline or disposing', async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => { release = () => reject(new Error('aborted')); });
    }));
    let settled = false;
    const starting = startTargetSampling(options(fetch)).then(owner => { settled = true; return owner; });
    await vi.advanceTimersByTimeAsync(5000);
    expect(settled).toBe(false);
    expect(fetch).toHaveBeenCalledOnce();
    expect(release).toBeTypeOf('function');
    release!();
    const owner = await starting;
    await owner.close();
    expect((await owner.finish()).samples[0]!.reason).toBe('timeout');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('timeout cancels a hung body and awaits the original stream cancellation', async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    const cancel = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(new ReadableStream({ cancel })));
    let settled = false;
    const starting = startTargetSampling(options(fetch)).then(owner => { settled = true; return owner; });
    await vi.advanceTimersByTimeAsync(100);
    expect(cancel).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    release!();
    const owner = await starting;
    await owner.close();
    expect((await owner.finish()).samples[0]!.reason).toBe('timeout');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('external cancellation drains an in-flight during request without overlap', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let release: (() => void) | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(json({ rss: 1 }))
      .mockImplementation((_url, init) => new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => { release = () => reject(new Error('cancelled')); });
      }));
    const owner = await startTargetSampling(options(fetch, { signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();
    let closed = false;
    const closing = owner.close().then(() => { closed = true; });
    await vi.advanceTimersByTimeAsync(10000);
    expect(closed).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
    release!();
    await closing;
    expect((await owner.finish()).samples[1]!.reason).toBe('cancelled');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('close skips cooldown and cancels its in-flight body', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(json({}))
      .mockImplementation(async () => new Response(new ReadableStream({ cancel })));
    const owner = await startTargetSampling(options(fetch));
    const finishing = owner.finish();
    await vi.advanceTimersByTimeAsync(0);
    await owner.close();
    const report = await finishing;
    expect(report.samples[1]).toMatchObject({ phase: 'after', reason: 'cancelled' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retires parent listener after baseline cleanup failure before rejecting startup', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    let failCleanup: ((error: Error) => void) | undefined;
    const cancel = vi.fn(() => new Promise<void>((_resolve, reject) => { failCleanup = reject; }));
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(new ReadableStream({ cancel })));
    let settled = false;
    const starting = startTargetSampling(options(fetch, { signal: controller.signal }));
    const rejection = expect(starting).rejects.toThrow('reader_cancel');
    const completion = starting.then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(100);
    expect(cancel).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    expect(remove).not.toHaveBeenCalled();
    failCleanup!(new Error('private cleanup diagnostic'));
    await rejection;
    await completion;
    expect(settled).toBe(true);
    expect(add).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledExactlyOnceWith('abort', add.mock.calls[0]![1]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('propagates failed original body cancellation through finish and close', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(json({}))
      .mockImplementation(async () => new Response(new ReadableStream({
        cancel: () => Promise.reject(new Error('private cleanup diagnostic')),
      })));
    const owner = await startTargetSampling(options(fetch));
    await vi.advanceTimersByTimeAsync(1100);
    await expect(owner.finish()).rejects.toThrow('reader_cancel');
    await expect(owner.close()).rejects.toThrow('reader_cancel');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops at 256 observations and keeps serialized report below one MiB', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ rss: Number.MAX_VALUE }));
    const owner = await startTargetSampling(options(fetch));
    await vi.advanceTimersByTimeAsync(300000);
    const report = await owner.finish();
    expect(report.samples).toHaveLength(256);
    expect(report.limited).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(256);
    expect(new TextEncoder().encode(JSON.stringify(report)).byteLength).toBeLessThanOrEqual(1048576);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('pre-aborted input makes no fetch and retains explicit unavailable baseline', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const owner = await startTargetSampling(options(fetch, { signal: controller.signal }));
    expect((await owner.finish()).samples[0]).toMatchObject({ phase: 'before', reason: 'cancelled' });
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
