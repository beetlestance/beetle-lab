import { fixture, native, resetNative } from './fixtures.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runAttempt } from '../../wrapper/attempt/attempt.js';
import { runCompiledK6 } from '../../wrapper/execution/index.js';

const cleanups: (() => Promise<void>)[] = [];
beforeEach(resetNative);
afterEach(async () => { await Promise.all(cleanups.splice(0).map(clean => clean())); });
async function setup() { const value = await fixture(); cleanups.push(value.cleanup); return value; }
function deferred() {
  let resolve!: () => void;
  return { promise: new Promise<void>(yes => { resolve = yes; }), resolve: () => resolve() };
}
it('concurrent reentry never launches another invocation', async () => {
  const f = await setup(); const build = deferred(); native.blockBuild = build.promise;
  const first = f.run(); await vi.waitFor(() => expect(native.built).toBeDefined());
  const second = await f.run(); expect(second.ok).toBe(false); expect(native.calls).toBe(0);
  build.resolve(); expect((await first).ok).toBe(true); expect(native.calls).toBe(1);
});
it('parent cancellation fences a late successful original build and awaits it', async () => {
  const f = await setup(); const build = deferred(); native.blockBuild = build.promise;
  let settled = false; const running = f.run().then(result => { settled = true; return result; });
  await vi.waitFor(() => expect(native.built).toBeDefined());
  f.controller.abort(); f.controller.abort(); await Promise.resolve(); expect(settled).toBe(false);
  build.resolve(); const result = await running;
  expect(result.reason).toBe('cancelled'); expect(result.result).toBeNull(); expect(result.quiescence.execution).toBe('confirmed');
  expect(native.calls).toBe(0);
});
it('prepare phase expiry preserves original build ownership with no late target start', async () => {
  const f = await setup(); f.manifest.phases.find(phase => phase.phase === 'prepare')!.timeoutMs = 30; await f.save();
  const build = deferred(); native.blockBuild = build.promise;
  const running = f.run(); await vi.waitFor(() => expect(native.built).toBeDefined());
  await new Promise(resolve => setTimeout(resolve, 60)); build.resolve();
  const result = await running; expect(result.reason).toBe('deadline'); expect(native.calls).toBe(0); expect(result.result).toBeNull();
});
it('sticky wall rollback fences later phase work', async () => {
  const f = await setup(); const original = f.clock.wall; let rollback = false;
  f.clock.wall = () => original() - Number(rollback);
  const result = await f.run({ onEvent: async event => { if (event.kind === 'phase.finished') rollback = true; } });
  expect(result.reason).toBe('clock'); expect(native.calls).toBe(0); expect(result.result).toBeNull();
});
it('retains late native stop facts but a failed original close prevents publication', async () => {
  const f = await setup(); native.closeFails = true;
  const result = await f.run();
  expect(result.reason).toBe('cleanup'); expect(result.execution?.process?.state).toBe('stopped');
  expect(result.quiescence.execution).toBe('failed'); expect(result.result).toBeNull(); expect(native.closes).toBe(1);
  expect(JSON.stringify(result)).not.toContain('SECRET_CLOSE_ERROR');
});
it('retains real build failure with no invented process, collection or assertion counts', async () => {
  const f = await setup(); native.buildFails = true; const phases: string[] = [];
  const result = await f.run({ onEvent: async event => { if (event.kind === 'phase.started') phases.push(event.phase); } });
  expect(result.ok).toBe(false); expect(result.execution).toMatchObject({ ok: false, code: 'build', process: null });
  expect(result.result).toBeNull(); expect(native.calls).toBe(0); expect(phases).toEqual(['validate', 'prepare']);
  expect(JSON.stringify(result)).not.toContain('SECRET_OS_ERROR');
});
it('a pending original native close prevents seal and remains owned', async () => {
  const f = await setup(); const close = deferred(); native.blockClose = close.promise;
  let settled = false; const running = f.run().then(value => { settled = true; return value; });
  await vi.waitFor(() => expect(native.closes).toBe(1));
  expect(settled).toBe(false); await expect(readFile(join(f.outputRoot, 'engine-result.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  close.resolve(); expect((await running).ok).toBe(true);
});
it('a timed-out original notification must quiesce before an eligible seal', async () => {
  const f = await setup(); const notification = deferred(); let calls = 0; let aborted = false;
  let settled = false;
  const running = f.run({ onEvent: async (_event, signal) => {
    calls++; signal.addEventListener('abort', () => { aborted = true; }); await notification.promise;
  } }).then(value => { settled = true; return value; });
  await vi.waitFor(() => expect(aborted).toBe(true), { timeout: 2000 });
  expect(settled).toBe(false); expect(calls).toBe(1);
  await expect(readFile(join(f.outputRoot, 'engine-result.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  notification.resolve(); const result = await running;
  expect(result.publication?.ok).toBe(true); expect(result.notifications).toBe('disabled'); expect(result.ok).toBe(false);
});
it('preserves a known published seal when terminal notification rejects', async () => {
  const f = await setup();
  const result = await f.run({ onEvent: async event => { if (event.kind === 'engine.result') throw new Error('SECRET_TRANSPORT'); } });
  expect(result.ok).toBe(false); expect(result.reason).toBe('notification'); expect(result.publication?.ok).toBe(true);
  expect(JSON.parse(await readFile(join(f.outputRoot, 'engine-result.json'), 'utf8'))).toEqual(result.result);
});
it('does not infer a stopped process from a successful void close', async () => {
  const f = await setup();
  const result = await runAttempt(f.options, { clock: f.clock, execute: options => {
    const actual = runCompiledK6(options);
    const final = actual.final.then(receipt => ({ ...receipt, ok: false as const, code: 'native' as const,
      process: receipt.process ? { ...receipt.process, state: 'unknown' as const, groupAbsent: false, quiescent: false } : null }));
    return { ...actual, final };
  } });
  expect(result.ok).toBe(false); expect(result.result).toBeNull(); expect(result.reason).toBe('mapping');
  expect(result.execution?.process?.state).toBe('unknown');
});
it('retains native output_limit without masking it as an extra wrapper crash', async () => {
  const f = await setup();
  const result = await runAttempt(f.options, { clock: f.clock, execute: options => {
    const actual = runCompiledK6(options);
    const final = actual.final.then(receipt => ({ ...receipt, ok: false as const, code: 'native' as const,
      process: receipt.process ? { ...receipt.process, cause: 'metric_limit' as const, collection: 'partial' as const } : null }));
    return { ...actual, final };
  } });
  expect(result.ok).toBe(false); expect(result.result?.execution).toMatchObject({ status: 'error', reason: 'output_limit' });
  expect(result.result?.outcome).toBe('inconclusive');
});
