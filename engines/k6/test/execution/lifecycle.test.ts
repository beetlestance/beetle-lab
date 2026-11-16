import { afterEach, expect, it, vi } from 'vitest';
import type { BuildOutput } from '../../build/index.js';
import { deferred, flush, launch, measured, observation, setup, summary } from './fixtures.js';

afterEach(() => { vi.useRealTimers(); });
it.each(['cancel', 'close', 'deadline'] as const)('fences late successful build after %s without losing original work', async cause => {
  vi.useFakeTimers();
  const f = setup(); const parent = new AbortController(); const gate = deferred<BuildOutput>();
  const operation = launch({ ...f.options, signal: parent.signal }, { ...f.ports, build: () => gate.promise });
  await flush();
  let quiet = false; void operation.quiesced.then(() => { quiet = true; });
  if (cause === 'cancel') parent.abort();
  else if (cause === 'close') void operation.close();
  else { f.state.mono = 8000; await vi.advanceTimersByTimeAsync(25); }
  expect(await operation.result).toMatchObject({ ok: false, code: cause === 'cancel' ? 'cancelled' : cause === 'close' ? 'closed' : 'deadline', process: null });
  expect(quiet).toBe(false); expect(f.state.created).toBe(0);
  expect(operation.close()).toBe(operation.quiesced);
  expect(operation.close()).toBe(operation.close());
  gate.resolve({ scriptPath: '/owned/output/suite.js', bytes: 100, peakBytes: 200 });
  await operation.quiesced; expect(f.state.created).toBe(0); expect(quiet).toBe(true);
});
it('retains a late failed build after cancellation without an unhandled rejection or native retry', async () => {
  const f = setup(); const parent = new AbortController(); const gate = deferred<BuildOutput>();
  const operation = launch({ ...f.options, signal: parent.signal }, { ...f.ports, build: () => gate.promise });
  await flush(); parent.abort(); expect(await operation.result).toMatchObject({ ok: false, code: 'cancelled' });
  gate.reject(new Error('private-builder')); await operation.quiesced;
  expect(f.state.created).toBe(0); expect(await operation.result).toMatchObject({ process: null });
});
it('closes a reentrantly created native owner without launching it', async () => {
  const f = setup(); let closed = 0; let ran = 0;
  const operation: ReturnType<typeof launch> = launch(f.options, { ...f.ports, native: () => {
    void operation.close();
    return { run: async () => { ran++; return observation(); }, close: async () => { closed++; } };
  } });
  expect(await operation.result).toMatchObject({ ok: false, code: 'closed', process: null });
  await operation.quiesced; expect(ran).toBe(0); expect(closed).toBe(1);
});
it('publishes unknown native evidence without waiting on its original unresolved close', async () => {
  const f = setup(); const gate = deferred(); let closes = 0;
  const operation = launch(f.options, { ...f.ports, native: () => ({
    run: async () => observation({ state: 'unknown', quiescent: false, groupAbsent: false, collection: 'partial' }),
    close: () => { closes++; return gate.promise; },
  }) });
  const receipt = await operation.result;
  expect(receipt).toMatchObject({ ok: false, code: 'native', process: { state: 'unknown' }, terminalObservedAt: null, summary: null });
  let quiet = false; void operation.quiesced.then(() => { quiet = true; }); await flush();
  expect(quiet).toBe(false); expect(closes).toBe(1);
  void operation.close(); void operation.close(); expect(closes).toBe(1);
  gate.resolve(); await operation.quiesced; expect(await operation.result).toBe(receipt);
});
it('retains the first failed native close outcome across repeated close calls', async () => {
  const f = setup(); const gate = deferred(); let calls = 0;
  const operation = launch(f.options, { ...f.ports, native: () => ({
    run: async () => observation({ state: 'unknown', quiescent: false, groupAbsent: false, collection: 'partial' }),
    close: () => { calls++; return gate.promise; },
  }) });
  expect(await operation.result).toMatchObject({ ok: false, code: 'native' });
  const first = operation.close(); gate.reject(new Error('private-close'));
  await expect(first).rejects.toMatchObject({ code: 'cleanup' });
  expect(operation.close()).toBe(first); await expect(operation.close()).rejects.toMatchObject({ code: 'cleanup' });
  expect(calls).toBe(1);
});
it('waits for successful original collector close before publishing complete pipeline evidence', async () => {
  const f = setup(); const gate = deferred(); const entered = deferred();
  const operation = launch(f.options, { ...f.ports, summary: () => ({ ...summary(), close: () => { entered.resolve(); return gate.promise; } }) });
  await entered.promise;
  let published = false; void operation.result.then(() => { published = true; }); await flush();
  expect(published).toBe(false);
  gate.resolve(); expect(await operation.result).toMatchObject({ ok: true }); await operation.quiesced;
});
it('rejects complete evidence when the original collector close fails', async () => {
  const f = setup(); const operation = launch(f.options, { ...f.ports,
    summary: () => ({ ...summary(), close: async () => { throw new Error('private-close'); } }) });
  const receipt = await operation.result;
  expect(receipt).toMatchObject({ ok: false, code: 'cleanup', process: { state: 'stopped' }, summary: { ok: true } });
  expect(JSON.stringify(receipt)).not.toContain('private-close');
  await expect(operation.quiesced).rejects.toMatchObject({ code: 'cleanup' });
});
it('awaits every original close even when another close throws synchronously', async () => {
  const f = setup(); const gate = deferred(); const entered = deferred(); const native = f.ports.native;
  const operation = launch(f.options, { ...f.ports, native: input => ({ ...native(input), close: () => { entered.resolve(); return gate.promise; } }),
    summary: () => ({ ...summary(), close: () => { throw new Error('private-close'); } }) });
  await entered.promise; let quiet = false; void operation.quiesced.catch(() => { quiet = true; }); await flush();
  expect(quiet).toBe(false); gate.resolve();
  expect(await operation.result).toMatchObject({ ok: false, code: 'cleanup' });
  await expect(operation.quiesced).rejects.toMatchObject({ code: 'cleanup' });
});
it('fences close invoked by a quiesced observer before final successful result publication', async () => {
  const f = setup(); const operation = launch(f.options, f.ports);
  void operation.quiesced.then(() => operation.close());
  expect(await operation.result).toMatchObject({ ok: false, code: 'closed' }); await operation.quiesced;
});
it('delivers cancellation to the native owner independently of a blocked marker callback', async () => {
  const f = setup(); const parent = new AbortController(); const entered = deferred(); const callback = deferred();
  const stopped = deferred<ReturnType<typeof observation>>(); let aborted = false; let closing = false;
  let sink: Promise<void> = Promise.resolve();
  const operation = launch({ ...f.options, signal: parent.signal, measureStarted: async () => { entered.resolve(); await callback.promise; } },
    { ...f.ports, native: input => ({ run: () => {
      input.signal!.addEventListener('abort', () => { aborted = true; stopped.resolve(observation({ collection: 'partial',
        cause: 'cancelled', state: 'unknown', quiescent: false, groupAbsent: false, metricBytes: measured().byteLength })); }, { once: true });
      sink = f.ports.native(input).run().then(() => undefined); void sink.catch(() => undefined); return stopped.promise;
    }, close: () => { closing = true; return sink; } }) });
  await entered.promise; parent.abort(); expect(await operation.result).toMatchObject({ ok: false, code: 'cancelled' });
  await flush(); expect(aborted).toBe(true); expect(closing).toBe(true);
  let quiet = false; void operation.quiesced.catch(() => { quiet = true; }); await flush(); expect(quiet).toBe(false);
  callback.resolve(); await expect(operation.quiesced).rejects.toMatchObject({ code: 'cleanup' });
});
it('does not publish numeric completion when final window persistence is blocked by cancellation', async () => {
  const f = setup(); const parent = new AbortController(); const entered = deferred(); const gate = deferred();
  const operation = launch({ ...f.options, signal: parent.signal, window: async () => { entered.resolve(); await gate.promise; } }, f.ports);
  await entered.promise; parent.abort();
  expect(await operation.result).toMatchObject({ ok: false, code: 'cancelled', metrics: null });
  let quiet = false; void operation.quiesced.then(() => { quiet = true; }); await flush(); expect(quiet).toBe(false);
  gate.resolve(); await operation.quiesced; expect(f.state.collected).toBe(0);
});
