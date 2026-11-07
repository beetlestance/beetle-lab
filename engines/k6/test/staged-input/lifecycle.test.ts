import type { FileHandle } from 'node:fs/promises';
import type * as Fs from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openStagedInput } from '../../wrapper/input/index.js';
import { fixture, now, opened } from './fixtures.js';
import type { Fixture } from './fixtures.js';

const io = vi.hoisted(() => ({ paths: [] as string[], handles: [] as FileHandle[],
  onOpen: undefined as ((handle: FileHandle, path: string) => void | Promise<void>) | undefined }));
vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof Fs>();
  return { ...actual, open: vi.fn(async (path: string, flags: number) => {
    const handle = await actual.open(path, flags);
    io.paths.push(path); io.handles.push(handle); await io.onOpen?.(handle, path); return handle;
  }) };
});
function gate(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve };
}
const fixtures: Fixture[] = [];
afterEach(async () => {
  io.onOpen = undefined; vi.restoreAllMocks();
  await Promise.allSettled(io.handles.splice(0).map(handle => handle.close())); io.paths = [];
  for (const item of fixtures.splice(0)) { item.controller.abort(); await item.cleanup(); }
});
async function setup(): Promise<Fixture> { const value = await fixture(); fixtures.push(value); return value; }
describe('staged IO lifecycle', () => {
  it('never opens a secret sentinel and opens datasets only during explicit compile', async () => {
    const value = await setup(); const session = await opened(value.options);
    expect(io.paths.map(path => path.split('/').at(-1))).toEqual(['staging.json', 'offer.json', 'manifest.json']);
    const operation = session.compile(); expect((await operation.result).ok).toBe(true); await operation.quiesced;
    expect(io.paths).toHaveLength(4); expect(io.paths[3]).toBe(join(value.options.inputRoot, 'input-000.bin'));
    expect(io.paths.some(path => path.startsWith(value.options.secretRoot))).toBe(false); await session.close();
  });
  it('carries elapsed setup time in the admitted budget without resetting it at compile', async () => {
    const value = await setup(); let wall = now;
    const session = await opened({ ...value.options, wallNow: () => wall }); wall += 59_000;
    const operation = session.compile(); const result = await operation.result; await operation.quiesced;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.attempt).toEqual({ mode: 'managed', timeoutMs: 60_000, deadlineMs: now + 60_000 });
    await session.close();
  });
  it.each([['expired', now + 60_000, 'deadline'], ['rollback', now - 1, 'clock_fenced'],
    ['invalid', NaN, 'clock_fenced'], ['outOfDate', 8_640_000_000_000_001, 'clock_fenced']] as const)('fences %s clocks before dataset IO', async (_name, next, code) => {
    const value = await setup(); let wall = now; const session = await opened({ ...value.options, wallNow: () => wall });
    wall = next; const operation = session.compile(); expect(await operation.result).toMatchObject({ ok: false, code });
    await operation.quiesced; expect(io.paths).toHaveLength(3); await session.close();
  });
  it('does not read Offer after learning that staged metadata is already expired', async () => {
    const value = await setup(); value.staging.deadlineMs = now; await value.save();
    const operation = openStagedInput(value.options); expect(await operation.result).toMatchObject({ ok: false, code: 'deadline' });
    await operation.quiesced; expect(io.paths).toEqual([join(value.options.inputRoot, 'staging.json')]);
  });
  it.each([-1, 0, 8_640_000_000_000_000])('rejects impossible admission interval at deadline %s', async deadlineMs => {
    const value = await setup(); value.staging.deadlineMs = deadlineMs; await value.save();
    const operation = openStagedInput(value.options); expect((await operation.result).ok).toBe(false); await operation.quiesced;
  });
  it('rejects admission in the future even before the wall deadline expires', async () => {
    const value = await setup(); value.staging.deadlineMs = now + 60_001; await value.save();
    const operation = openStagedInput(value.options); expect(await operation.result).toMatchObject({ ok: false, code: 'clock_fenced' });
    await operation.quiesced;
  });
  it('cancels before any IO when signal already aborted', async () => {
    const value = await setup(); value.controller.abort(); const operation = openStagedInput(value.options);
    expect(await operation.result).toEqual({ ok: false, code: 'cancelled' }); await operation.quiesced; expect(io.paths).toEqual([]);
  });
  it('suppresses late open success on cancellation while quiescence waits for adoption and close', async () => {
    const value = await setup(); const session = await opened(value.options); const issued = gate(); const release = gate();
    let descriptorClosed = false;
    io.onOpen = async (handle, path) => {
      if (!path.endsWith('input-000.bin')) return;
      const original = handle.close.bind(handle);
      vi.spyOn(handle, 'close').mockImplementation(async () => { await original(); descriptorClosed = true; });
      issued.resolve(); await release.promise;
    };
    const operation = session.compile(); await issued.promise; value.controller.abort();
    expect(await operation.result).toEqual({ ok: false, code: 'cancelled' });
    let quiet = false; void operation.quiesced.then(() => { quiet = true; }); await Promise.resolve();
    expect(quiet).toBe(false); expect(descriptorClosed).toBe(false);
    const close = session.close(); expect(session.close()).toBe(close);
    release.resolve(); await operation.quiesced; await close;
    expect(descriptorClosed).toBe(true); expect(await session.compile().result).toEqual({ ok: false, code: 'closed' });
  });
  it('times out a slow initial header independently of unresolved kernel IO', async () => {
    const value = await setup(); const issued = gate(); const release = gate();
    io.onOpen = async (_handle, path) => { if (path.endsWith('staging.json')) { issued.resolve(); await release.promise; } };
    const operation = openStagedInput({ ...value.options, headerTimeoutMs: 40 }); await issued.promise;
    expect(await operation.result).toEqual({ ok: false, code: 'deadline' });
    let quiet = false; void operation.quiesced.then(() => { quiet = true; }); await Promise.resolve(); expect(quiet).toBe(false);
    release.resolve(); await operation.quiesced; expect(io.paths).toHaveLength(1);
  });
  it('uses the admitted monotonic ceiling even when the injected wall clock stops advancing', async () => {
    const value = await setup(); value.offer.budget.timeoutMs = 500; value.staging.deadlineMs = now + 500; await value.save();
    const session = await opened(value.options); const issued = gate(); const release = gate();
    io.onOpen = async (_handle, path) => { if (path.endsWith('input-000.bin')) { issued.resolve(); await release.promise; } };
    const operation = session.compile(); await issued.promise;
    expect(await operation.result).toEqual({ ok: false, code: 'deadline' });
    release.resolve(); await operation.quiesced; await session.close();
  });
  it('fences IO when trusted clock callback cancels synchronously', async () => {
    const value = await setup(); let cancel = false;
    const session = await opened({ ...value.options, wallNow: () => { if (cancel) value.controller.abort(); return now; } });
    cancel = true; const operation = session.compile(); expect(await operation.result).toEqual({ ok: false, code: 'cancelled' });
    await operation.quiesced; expect(io.paths).toHaveLength(3); await session.close();
  });
  it('owns compile before a trusted clock callback reenters compile', async () => {
    const value = await setup(); let reenter: (() => void) | undefined;
    const session = await opened({ ...value.options, wallNow: () => { const callback = reenter; reenter = undefined; callback?.(); return now; } });
    let second: ReturnType<typeof session.compile> | undefined;
    reenter = () => { second = session.compile(); };
    const operation = session.compile(); expect((await operation.result).ok).toBe(true); await operation.quiesced;
    expect(await second!.result).toEqual({ ok: false, code: 'already_compiled' }); await session.close();
  });
  it('suppresses publication when abort arrives at quiescence before result delivery', async () => {
    const value = await setup(); const session = await opened(value.options); const operation = session.compile();
    void operation.quiesced.then(() => value.controller.abort());
    expect(await operation.result).toEqual({ ok: false, code: 'cancelled' }); await operation.quiesced; await session.close();
  });
  it('adopts active work before a clock callback closes the loader synchronously', async () => {
    const value = await setup(); let close: (() => void) | undefined;
    const session = await opened({ ...value.options, wallNow: () => { const callback = close; close = undefined; callback?.(); return now; } });
    let closure: Promise<void> | undefined; close = () => { closure = session.close(); };
    const operation = session.compile(); expect(await operation.result).toEqual({ ok: false, code: 'closed' });
    await operation.quiesced; await closure; expect(io.paths).toHaveLength(3);
  });
  it('retains original failed close outcome and never retries a misleading idempotent close', async () => {
    const value = await setup(); const session = await opened(value.options);
    let closeCalls = 0;
    io.onOpen = (handle, path) => {
      if (path.endsWith('input-000.bin')) vi.spyOn(handle, 'close').mockImplementation(async () => { closeCalls++; throw new Error('PRIVATE_CLOSE'); });
    };
    const operation = session.compile(); expect(await operation.result).toEqual({ ok: false, code: 'filesystem' });
    await expect(operation.quiesced).rejects.toMatchObject({ code: 'filesystem' });
    const close = session.close(); expect(session.close()).toBe(close); await expect(close).rejects.toMatchObject({ code: 'filesystem' });
    expect(closeCalls).toBe(1); expect(await session.compile().result).toEqual({ ok: false, code: 'closed' });
  });
  it('does not publish headers when their descriptor close failed', async () => {
    const value = await setup(); let calls = 0;
    io.onOpen = handle => { vi.spyOn(handle, 'close').mockImplementation(async () => { calls++; throw new Error('PRIVATE_HEADER_CLOSE'); }); };
    const operation = openStagedInput(value.options); expect(await operation.result).toEqual({ ok: false, code: 'filesystem' });
    await expect(operation.quiesced).rejects.toMatchObject({ code: 'filesystem' }); expect(calls).toBe(1);
  });
  it('keeps quiescence pending through slow original close and preserves its late failure', async () => {
    const value = await setup(); const session = await opened(value.options); const issued = gate(); const release = gate(); let calls = 0;
    io.onOpen = (handle, path) => {
      if (!path.endsWith('input-000.bin')) return;
      const original = handle.close.bind(handle);
      vi.spyOn(handle, 'close').mockImplementation(async () => {
        calls++; issued.resolve(); await release.promise; await original(); throw new Error('PRIVATE_LATE_CLOSE');
      });
    };
    const operation = session.compile(); await issued.promise; value.controller.abort();
    expect(await operation.result).toEqual({ ok: false, code: 'cancelled' });
    let quiet = false; void operation.quiesced.then(() => { quiet = true; }, () => { quiet = true; });
    const closure = session.close(); void closure.catch(() => undefined);
    await Promise.resolve(); expect(quiet).toBe(false); release.resolve();
    await expect(operation.quiesced).rejects.toMatchObject({ code: 'filesystem' });
    await expect(closure).rejects.toMatchObject({ code: 'filesystem' }); expect(calls).toBe(1);
    expect(await operation.result).toEqual({ ok: false, code: 'cancelled' });
  });
});
