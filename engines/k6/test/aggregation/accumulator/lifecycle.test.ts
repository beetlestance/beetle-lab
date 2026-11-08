import { expect, it, vi } from 'vitest';
import type { MetricAccumulator, MetricWindow } from '../../../aggregation/index.js';
import { deferred, marker, point, setup, signal } from './fixtures.js';

async function ready(sink: (window: MetricWindow, signal: AbortSignal) => Promise<void>) {
  const { accumulator } = setup(sink);
  await accumulator.point(marker(), signal()); await accumulator.point(point(), signal());
  return accumulator;
}

it('serially awaits sink backpressure and refuses parallel calls including cancelled contenders', async () => {
  const entered = deferred(); const gate = deferred();
  const sink = vi.fn(async () => { entered.resolve(); await gate.promise; });
  const accumulator = await ready(sink);
  const pending = accumulator.point(point('beetle_requests', 2, 4000), signal());
  await entered.promise;
  const cancelled = new AbortController(); cancelled.abort();
  await expect(accumulator.point(point(), cancelled.signal)).rejects.toMatchObject({ code: 'busy' });
  await expect(accumulator.finish(signal())).rejects.toMatchObject({ code: 'busy' });
  expect(sink).toHaveBeenCalledTimes(1);
  gate.resolve(); await pending;
  const result = await accumulator.finish(signal());
  expect(result.totals[0]!.total).toEqual({ kind: 'counter', sum: 3 });
});

it('snapshots caller points and leaves callback mutation unable to corrupt active totals', async () => {
  const accumulator = await ready(async window => {
    expect(Reflect.set(window.series[0]!.total, 'sum', 999)).toBe(false);
    expect(Reflect.set(window.series[0]!.tags, 'request', 'r1')).toBe(false);
  });
  const input = { ...point('beetle_requests', 2, 4000), tags: { phase: 'execute' as const, request: 'r1' } };
  const pending = accumulator.point(input, signal());
  input.value = 999; input.tags.request = 'r2';
  await pending;
  const result = await accumulator.finish(signal());
  expect(result.totals.map(item => [item.tags, item.total])).toEqual([
    [{ phase: 'execute', request: 'r0' }, { kind: 'counter', sum: 1 }], [{ phase: 'execute', request: 'r1' }, { kind: 'counter', sum: 2 }],
  ]);
});

it('fences abort after a successful callback and keeps close pending on the original sink', async () => {
  const entered = deferred(); const gate = deferred();
  const accumulator = await ready(async () => { entered.resolve(); await gate.promise; });
  const controller = new AbortController();
  const pending = accumulator.point(point('beetle_requests', 2, 4000), controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ code: 'closed' });
  await entered.promise; controller.abort();
  const close = accumulator.close(); expect(accumulator.close()).toBe(close);
  let closed = false; void close.catch(() => {}).finally(() => { closed = true; });
  await Promise.resolve(); expect(closed).toBe(false);
  // close fences success too; because it was called before completion its code wins.
  gate.resolve();
  await expect(close).rejects.toMatchObject({ code: 'closed' });
  await rejected;
});

it('reports cancellation without close and poisons subsequent finish', async () => {
  const entered = deferred(); const gate = deferred();
  const accumulator = await ready(async () => { entered.resolve(); await gate.promise; });
  const controller = new AbortController();
  const pending = accumulator.point(point('beetle_requests', 1, 4000), controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  await entered.promise; controller.abort(); gate.resolve(); await rejected;
  await expect(accumulator.finish(signal())).rejects.toMatchObject({ code: 'cancelled' });
});

it('adopts pending work before callback reentry closes and waits for the same sink', async () => {
  const gate = deferred(); const entered = deferred();
  let closing!: Promise<void>;
  let reentry!: Promise<void>;
  const accumulator: MetricAccumulator = await ready(async () => {
    reentry = accumulator.point(point(), signal());
    void reentry.catch(() => {});
    closing = accumulator.close(); void closing.catch(() => {});
    entered.resolve(); await gate.promise;
  });
  const pending = accumulator.finish(signal());
  const rejected = expect(pending).rejects.toMatchObject({ code: 'closed' });
  await entered.promise;
  await expect(reentry).rejects.toMatchObject({ code: 'busy' });
  expect(accumulator.close()).toBe(closing);
  gate.resolve(); await rejected;
  await expect(closing).rejects.toMatchObject({ code: 'closed' });
});

it('surfaces sink failure with no later successful finish or hidden retry', async () => {
  const sink = vi.fn(async () => { throw new Error('private sink diagnostic'); });
  const accumulator = await ready(sink);
  const error: unknown = await accumulator.finish(signal()).catch((error: unknown) => error);
  expect(error).toMatchObject({ code: 'sink_failed' }); expect(String(error)).not.toContain('private');
  await expect(accumulator.finish(signal())).rejects.toMatchObject({ code: 'sink_failed' });
  expect(sink).toHaveBeenCalledTimes(1);
});

it('handles closed, aborted and empty measured one-shot accumulators honestly', async () => {
  const closed = setup().accumulator; await closed.close();
  await expect(closed.point(marker(), signal())).rejects.toMatchObject({ code: 'closed' });
  const cancelled = new AbortController(); cancelled.abort();
  await expect(setup().accumulator.point(marker(), cancelled.signal)).rejects.toMatchObject({ code: 'cancelled' });
  const { accumulator } = setup(); await accumulator.point(marker(), signal());
  expect((await accumulator.finish(signal())).totals).toEqual([]);
  await expect(accumulator.finish(signal())).rejects.toMatchObject({ code: 'closed' });
});
