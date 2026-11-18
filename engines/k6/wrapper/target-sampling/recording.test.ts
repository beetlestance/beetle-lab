import { afterEach, expect, it, vi } from 'vitest';
import { startTargetSampling } from './index.js';
import type { TargetSamplingOptions } from './index.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
function options(record: NonNullable<TargetSamplingOptions['record']>): TargetSamplingOptions {
  return { target: 'http://synthetic.invalid', signal: new AbortController().signal,
    config: { path: '/metrics', intervalMs: 1000, timeoutMs: 100, cooldownMs: 0 },
    fetch: async () => new Response(JSON.stringify({ rss: 1 })), record };
}
afterEach(() => vi.useRealTimers());
it('records the frozen baseline before startup resolves, with no overlapping observation', async () => {
  vi.useFakeTimers();
  const gate = deferred(); const entered = deferred();
  const input = options(async sample => { expect(Object.isFrozen(sample)).toBe(true); entered.resolve(); await gate.promise; });
  const fetch = vi.fn(input.fetch!); let started = false;
  const starting = startTargetSampling({ ...input, fetch }).then(owner => { started = true; return owner; });
  await entered.promise; await vi.advanceTimersByTimeAsync(10000);
  expect(started).toBe(false); expect(fetch).toHaveBeenCalledOnce();
  gate.resolve(); const owner = await starting;
  expect(owner.recent(1)[0]?.phase).toBe('before'); await owner.close();
});
it('keeps recording serial and close waits for its actual aborted original', async () => {
  vi.useFakeTimers();
  const gate = deferred(); const entered = deferred(); let calls = 0; let recordingSignal: AbortSignal | undefined;
  const input = options(async (_sample, signal) => { if (++calls === 2) { recordingSignal = signal; entered.resolve(); await gate.promise; } });
  const fetch = vi.fn(input.fetch!); const owner = await startTargetSampling({ ...input, fetch });
  await vi.advanceTimersByTimeAsync(1000); await entered.promise;
  expect(owner.recent(256)).toHaveLength(1);
  let closed = false; const closing = owner.close().then(() => { closed = true; });
  await vi.advanceTimersByTimeAsync(10000);
  expect(recordingSignal?.aborted).toBe(true); expect(closed).toBe(false); expect(fetch).toHaveBeenCalledTimes(2);
  gate.resolve(); await closing;
  expect(owner.recent(256)).toHaveLength(2); expect(vi.getTimerCount()).toBe(0);
});
it('propagates a baseline recording failure and retires its parent listener', async () => {
  const input = options(async () => { throw new Error('synthetic record failure'); });
  const remove = vi.spyOn(input.signal, 'removeEventListener');
  await expect(startTargetSampling(input)).rejects.toThrow('synthetic record failure');
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
});
it('withdraws failed recording from the in-memory report and rejects finish and close', async () => {
  vi.useFakeTimers(); let calls = 0;
  const input = options(async () => { if (++calls === 2) throw new Error('synthetic record failure'); });
  const owner = await startTargetSampling(input);
  await vi.advanceTimersByTimeAsync(10000);
  expect(calls).toBe(2); expect(owner.recent(256)).toHaveLength(1);
  await expect(owner.finish()).rejects.toThrow('synthetic record failure');
  await expect(owner.close()).rejects.toThrow('synthetic record failure');
  expect(vi.getTimerCount()).toBe(0);
});
it('records exactly the retained 256 samples without a queue or additional observation', async () => {
  vi.useFakeTimers(); const record = vi.fn<NonNullable<TargetSamplingOptions['record']>>(async () => {});
  const owner = await startTargetSampling(options(record));
  await vi.advanceTimersByTimeAsync(300000);
  const report = await owner.finish();
  expect(record).toHaveBeenCalledTimes(256); expect(report.samples).toHaveLength(256); expect(report.limited).toBe(true);
  expect(report.samples).toEqual(record.mock.calls.map(call => call[0]));
  await owner.close();
});
