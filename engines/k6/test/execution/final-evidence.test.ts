import { afterEach, expect, it, vi } from 'vitest';
import type { BuildOutput } from '../../build/index.js';
import type { ProcessObservation } from '../../wrapper/process/index.js';
import type { SummaryResult } from '../../wrapper/collection/index.js';
import { runCompiledK6 } from '../../wrapper/execution/index.js';
import { deferred, flush, launch, observation, setup, summary } from './fixtures.js';

afterEach(() => { vi.useRealTimers(); });
it.each(['cancelled', 'deadline'] as const)('keeps the first %s snapshot and exposes a later actual native stop only in final', async code => {
  vi.useFakeTimers();
  const f = setup(); const parent = new AbortController(); const entered = deferred(); const stopped = deferred<ProcessObservation>();
  const operation = launch({ ...f.options, signal: parent.signal }, { ...f.ports,
    native: () => ({ run: () => { entered.resolve(); return stopped.promise; }, close: async () => {} }) });
  await entered.promise;
  if (code === 'cancelled') parent.abort();
  else { f.state.mono = 8000; await vi.advanceTimersByTimeAsync(25); }
  const first = await operation.result;
  expect(first).toMatchObject({ ok: false, code, process: null, terminalObservedAt: null });
  f.state.wall = 3000;
  const actual = observation({ cause: code, signal: 'SIGTERM', exitCode: null, collection: 'partial' });
  stopped.resolve(actual); await operation.quiesced;
  const final = await operation.final;
  expect(final).toMatchObject({ ok: false, code, process: actual, terminalObservedAt: '1970-01-01T00:00:03.000Z' });
  expect(await operation.result).toBe(first); expect(first.process).toBeNull(); expect(first.terminalObservedAt).toBeNull();
  expect(Object.isFrozen(final)).toBe(true);
});
it('does not turn an invalid late terminal clock into a timestamp', async () => {
  const f = setup(); const parent = new AbortController(); const entered = deferred(); const stopped = deferred<ProcessObservation>();
  const operation = launch({ ...f.options, signal: parent.signal }, { ...f.ports,
    native: () => ({ run: () => { entered.resolve(); return stopped.promise; }, close: async () => {} }) });
  await entered.promise; parent.abort(); const first = await operation.result;
  f.state.wall = NaN; stopped.resolve(observation({ cause: 'cancelled', signal: 'SIGTERM', exitCode: null, collection: 'partial' }));
  await operation.quiesced;
  expect(await operation.final).toMatchObject({ ok: false, code: 'cancelled', process: { state: 'stopped' }, terminalObservedAt: null });
  expect(await operation.result).toBe(first);
});
it('exposes real late build byte facts without launching or manufacturing a process observation', async () => {
  const f = setup(); const parent = new AbortController(); const entered = deferred(); const built = deferred<BuildOutput>();
  const operation = launch({ ...f.options, signal: parent.signal }, { ...f.ports,
    build: () => { entered.resolve(); return built.promise; } });
  await entered.promise; parent.abort(); const first = await operation.result;
  expect(first).toMatchObject({ ok: false, code: 'cancelled', build: null, process: null });
  const actual = { scriptPath: '/owned/output/suite.js', bytes: 1234, peakBytes: 2345 };
  built.resolve(actual); await operation.quiesced;
  expect(await operation.final).toMatchObject({ ok: false, code: 'cancelled', build: actual, process: null, terminalObservedAt: null });
  expect(f.state.created).toBe(0); expect(await operation.result).toBe(first); expect(first.build).toBeNull();
});
it('keeps final pending through the original close and never derives stop from its void fulfillment', async () => {
  const f = setup(); const closing = deferred();
  const unknown = observation({ state: 'unknown', groupAbsent: false, quiescent: false, collection: 'partial' });
  const operation = launch(f.options, { ...f.ports, native: () => ({ run: async () => unknown, close: () => closing.promise }) });
  try {
    const first = await operation.result;
    expect(operation.final).toBeInstanceOf(Promise);
    let finished = false; void operation.final.then(() => { finished = true; }); await flush(); expect(finished).toBe(false);
    closing.resolve(); await operation.quiesced;
    const final = await operation.final;
    expect(final).toMatchObject({ ok: false, code: 'native', process: unknown, terminalObservedAt: null });
    expect(await operation.result).toBe(first); expect(final.process!.quiescent).toBe(false);
  } finally { closing.resolve(); await operation.quiesced; }
});
it('retains late actual stop facts and first cancellation when close fails, while original close remains rejected', async () => {
  const f = setup(); const parent = new AbortController(); const entered = deferred();
  const stopped = deferred<ProcessObservation>(); const closing = deferred();
  const operation = launch({ ...f.options, signal: parent.signal }, { ...f.ports, native: () => ({
    run: () => { entered.resolve(); return stopped.promise; }, close: () => closing.promise,
  }) });
  await entered.promise; parent.abort(); const first = await operation.result;
  const actual = observation({ cause: 'cancelled', signal: 'SIGTERM', exitCode: null, collection: 'partial' });
  stopped.resolve(actual); await flush(); const close = operation.close();
  closing.reject(new Error('private-close-canary'));
  const originalError: unknown = await close.catch((error: unknown) => error);
  expect(originalError).toMatchObject({ code: 'cleanup' }); expect(operation.close()).toBe(close);
  expect(await operation.close().catch((error: unknown) => error)).toBe(originalError);
  const final = await operation.final;
  expect(final).toMatchObject({ ok: false, code: 'cancelled', process: actual });
  expect(JSON.stringify(final)).not.toContain('private-close-canary'); expect(await operation.result).toBe(first);
  await expect(operation.quiesced).rejects.toBe(originalError);
});
it('preserves published success after an ordinary later caller close', async () => {
  const f = setup(); const operation = launch(f.options, f.ports); const first = await operation.result;
  expect(first.ok).toBe(true); await operation.close();
  expect(await operation.final).toEqual(first); expect(await operation.result).toBe(first);
});
it('retains a quiesced-observer publication fence instead of upgrading to the completed work outcome', async () => {
  const f = setup(); const operation = launch(f.options, f.ports);
  void operation.quiesced.then(() => operation.close());
  const first = await operation.result; expect(first).toMatchObject({ ok: false, code: 'closed' });
  expect(await operation.final).toMatchObject({ ok: false, code: 'closed', process: { state: 'stopped' } });
  expect(await operation.result).toBe(first);
});
it('exposes a late collector result only after all original collector cleanup settles', async () => {
  const f = setup(); const parent = new AbortController(); const entered = deferred();
  const received = deferred<SummaryResult>(); const quiet = deferred(); const actual = await summary().result;
  const operation = launch({ ...f.options, signal: parent.signal }, { ...f.ports, summary: () => {
    entered.resolve(); return { result: received.promise, quiesced: quiet.promise, close: () => quiet.promise };
  } });
  try {
    await entered.promise; parent.abort(); const first = await operation.result; expect(first.summary).toBeNull();
    received.resolve(actual); await flush(); expect(operation.final).toBeInstanceOf(Promise);
    let finished = false; void operation.final.then(() => { finished = true; }); await flush(); expect(finished).toBe(false);
    quiet.resolve(); await operation.quiesced;
    expect(await operation.final).toMatchObject({ ok: false, code: 'cancelled', summary: actual });
    expect(await operation.result).toBe(first); expect(first.summary).toBeNull();
  } finally { received.resolve(actual); quiet.resolve(); await operation.quiesced; }
});
it('exposes the same immediate immutable invalid-profile receipt on both public channels', async () => {
  const f = setup(); const operation = runCompiledK6({ ...f.options, outputDirectory: 'invalid' });
  expect(operation.final).toBeInstanceOf(Promise);
  const first = await operation.result; expect(first).toMatchObject({ ok: false, code: 'profile' });
  expect(await operation.final).toBe(first); expect(Object.isFrozen(first)).toBe(true); await operation.quiesced;
});
