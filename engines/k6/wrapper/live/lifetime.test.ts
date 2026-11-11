import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createLiveMetricPublisher } from './index.js';
import { deferred, fixture, window } from './fixtures.js';
beforeEach(() => vi.useFakeTimers());
afterEach(() => {vi.clearAllTimers(); vi.useRealTimers();});
it('fences stop synchronously, discards pending without flush and drains both actual originals', async () => {
  const write = deferred(); const close = deferred(); let signal: AbortSignal | undefined;
  const sink = {write: vi.fn((_bytes: Uint8Array, hint: AbortSignal) => {signal = hint; return write.promise;}), close: vi.fn(() => close.promise)};
  const f = fixture({sink}); f.publisher.accept(window(1)); await f.advance(); f.publisher.accept(window(2));
  const completion = f.publisher.stop(); expect(f.publisher.close()).toBe(completion); expect(signal?.aborted).toBe(true);
  expect(f.publisher.accept(window(3))).toBe(false); expect(f.publisher.state()).toMatchObject({writing: true, discardedOnStop: 1});
  expect(sink.close).not.toHaveBeenCalled(); let finished = false; void completion.then(() => {finished = true;});
  await f.advance(50000); expect(sink.write).toHaveBeenCalledTimes(1); expect(finished).toBe(false);
  write.resolve(); await f.advance(); expect(sink.close).toHaveBeenCalledTimes(1); expect(finished).toBe(false);
  close.resolve(); expect(await completion).toMatchObject({quiescence: 'confirmed', state: {status: 'closed', pending: false}});
});
it('retains one close promise even when the sink reenters stop from its abort handler', async () => {
  const write = deferred(); let nested: ReturnType<ReturnType<typeof fixture>['publisher']['stop']> | undefined;
  const f = fixture({sink: {write: async (_bytes, signal) => {signal.addEventListener('abort', () => {nested = f.publisher.stop();}); await write.promise;}, close: async () => {}}});
  f.publisher.accept(window(1)); await f.advance(); const stop = f.publisher.stop(); expect(nested).toBe(stop);
  write.resolve(); expect((await stop).quiescence).toBe('confirmed');
});
it('charges failed original bytes and preserves the first failure through failed cleanup', async () => {
  const f = fixture({sink: {write: async () => {throw new Error('private write');}, close: async () => {throw new Error('private close');}}});
  f.publisher.accept(window(1)); await f.advance(); expect(f.publisher.state()).toMatchObject({reason: 'sink', publishedSequence: 0});
  expect(f.publisher.state().chargedBytes).toBeGreaterThan(0); expect(await f.publisher.close()).toMatchObject({quiescence: 'failed', state: {reason: 'sink'}});
});
it('rejects a lifetime charge before write, and fences wall rollback and deadlines', async () => {
  const quota = fixture({maximumProducedBytes: 1}); quota.publisher.accept(window(1)); await quota.advance();
  expect(quota.write).not.toHaveBeenCalled(); expect(quota.publisher.state().reason).toBe('quota'); await quota.publisher.close();
  const clock = fixture(); clock.rollback(); expect(clock.publisher.accept(window(1))).toBe(false);
  expect(clock.publisher.state().reason).toBe('clock'); await clock.publisher.close();
  const deadline = fixture({timeoutMs: 10}); await deadline.advance(10);
  expect(deadline.publisher.state().reason).toBe('deadline'); expect(deadline.publisher.accept(window(1))).toBe(false); await deadline.publisher.close();
});
it('starts no write for an already aborted owner and captures trusted methods once', async () => {
  const f = fixture({signal: AbortSignal.abort()}); expect(f.publisher.accept(window(1))).toBe(false); await f.publisher.close(); expect(f.write).not.toHaveBeenCalled();
  const fresh = fixture(); fresh.options.sink.write = async () => {throw new Error('replacement');};
  fresh.publisher.accept(window(1)); await fresh.advance(); expect(fresh.write).toHaveBeenCalledTimes(1); await fresh.publisher.close();
});
it.each(['timeout', 'bytes', 'subset', 'scope', 'hash'] as const)('rejects invalid options before any sink effects: %s', async kind => {
  const f = fixture(); await f.publisher.close(); f.close.mockClear();
  const options = {...f.options, timeoutMs: kind === 'timeout' ? 0 : f.options.timeoutMs, maximumProducedBytes: kind === 'bytes' ? 0 : f.options.maximumProducedBytes};
  if (kind === 'subset') options.subset = {...options.subset, selected: []};
  if (kind === 'scope') options.scope = {...options.scope, generation: 0};
  if (kind === 'hash') options.hash = () => 'wrong';
  expect(() => createLiveMetricPublisher(options)).toThrow(expect.objectContaining({code: 'invalid_options'})); expect(f.write).not.toHaveBeenCalled(); expect(f.close).not.toHaveBeenCalled();
});
