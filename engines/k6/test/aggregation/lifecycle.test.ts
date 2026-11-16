import { expect, it, vi } from 'vitest';
import { MetricStream } from '../../aggregation/index.js';
import type { MetricStreamOptions } from '../../aggregation/index.js';
const chunk = Buffer.from(JSON.stringify({ type: 'Metric', metric: 'requests', data: { type: 'counter' } }) + '\n'
  + JSON.stringify({ type: 'Point', metric: 'requests', data: { time: '2026-11-07T12:00:00Z', value: 1, tags: {} } }) + '\n');
function setup(point: MetricStreamOptions['point']) {
  return new MetricStream({ metrics: [{ name: 'requests', kind: 'counter' }], requestLabels: [], assertionLabels: [],
    maximumBytes: 1_000_000, maximumRecords: 100, point });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
it('backpressures one sink and refuses concurrent pushes without poisoning it', async () => {
  const gate = deferred(); const called = deferred();
  const point = vi.fn(async () => { called.resolve(); await gate.promise; });
  const stream = setup(point); const controller = new AbortController();
  const work = stream.push(chunk, controller.signal); await called.promise;
  await expect(stream.push(chunk, controller.signal)).rejects.toMatchObject({ code: 'busy' });
  expect(() => stream.finish()).toThrowError(expect.objectContaining({ code: 'busy' }));
  gate.resolve(); await work; expect(stream.finish().records).toBe(2); expect(point).toHaveBeenCalledTimes(1);
});
it('cancellation/close suppresses late sink completion and retains close outcome', async () => {
  for (const action of ['abort', 'close'] as const) {
    const gate = deferred(); const called = deferred(); const controller = new AbortController();
    const stream = setup(async () => { called.resolve(); await gate.promise; });
    const work = stream.push(chunk, controller.signal); const observed = work.catch(error => error as unknown);
    await called.promise;
    let closing: Promise<void> | undefined;
    if (action === 'abort') controller.abort(); else closing = stream.close();
    let quiesced = false; if (closing) void closing.catch(() => undefined).then(() => { quiesced = true; });
    await Promise.resolve(); expect(quiesced).toBe(false);
    gate.resolve(); expect(await observed).toMatchObject({ code: action === 'abort' ? 'cancelled' : 'closed' });
    if (closing) {
      await expect(closing).rejects.toMatchObject({ code: 'closed' });
      expect(stream.close()).toBe(closing);
    }
    expect(() => stream.finish()).toThrow();
  }
});
it('publishes work before callback reentry and never reports a failed sink as success', async () => {
  let closing: Promise<void> | undefined;
  const stream = setup(async () => { closing = stream.close(); void closing.catch(() => undefined); });
  await expect(stream.push(chunk, new AbortController().signal)).rejects.toMatchObject({ code: 'closed' });
  expect(stream.close()).toBe(closing); await expect(closing).rejects.toMatchObject({ code: 'closed' });
  const failed = setup(async () => { throw new Error('PRIVATE_SENTINEL'); });
  const error = await failed.push(chunk, new AbortController().signal).catch((value: unknown) => value);
  expect(error).toMatchObject({ code: 'sink_failed' }); expect(String(error)).not.toContain('PRIVATE_SENTINEL');
});
it('denies already aborted input without any sink callback', async () => {
  const point = vi.fn(async () => undefined); const stream = setup(point); const controller = new AbortController(); controller.abort();
  await expect(stream.push(chunk, controller.signal)).rejects.toMatchObject({ code: 'cancelled' }); expect(point).not.toHaveBeenCalled();
});
it('refuses a pre-aborted concurrent push as busy without poisoning its owner', async () => {
  const called = deferred(); const gate = deferred(); const stream = setup(async () => { called.resolve(); await gate.promise; });
  const first = stream.push(chunk, new AbortController().signal); await called.promise;
  const cancelled = new AbortController(); cancelled.abort();
  await expect(stream.push(chunk, cancelled.signal)).rejects.toMatchObject({ code: 'busy' });
  gate.resolve(); await first; expect(stream.finish().records).toBe(2);
});
