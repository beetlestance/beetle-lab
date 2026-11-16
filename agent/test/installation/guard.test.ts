import { expect, it, vi } from 'vitest';
import type { OutputWatch } from '../../src/guard/index.js';
import type { InstallationController } from '../../src/installation/index.js';
import { controlled } from '../supervisor/fixtures.js';
import { deferred, fixture, operation, scope } from './fixtures.js';

const f = fixture();
function watchFixture(initially: boolean | null = true, closingOriginal: Promise<void> = Promise.resolve()) {
  const initial = deferred<{ ready: boolean }>(); let ready = initially ?? false; let closed = false;
  if (initially !== null) initial.resolve({ ready });
  const close = vi.fn(() => {
    closed = true; initial.resolve({ ready: false }); return closingOriginal;
  });
  const watch: OutputWatch = { initial: initial.promise,
    status: () => ({ ready: ready && !closed, closed, stopRequested: false, lastKnownAt: ready ? 0 : null }), close };
  return { watch, close, initial, good() { ready = true; initial.resolve({ ready: true }); } };
}

it('prepares once and gates launch on an initial ready watch, then drains it on release', async () => {
  const e = await f.setup(); const w = watchFixture(null); const watch = vi.fn(() => w.watch);
  const manager = e.create({ guard: { watch } }); await e.accepted(manager);
  const driving = manager.drive(scope(e.offer), operation());
  try { await vi.waitFor(() => { expect(watch).toHaveBeenCalledOnce(); }); expect(e.backend.creates).toBe(0); }
  finally { w.good(); }
  expect(await driving).toMatchObject({ kind: 'runtime' });
  expect(e.backend.starts).toBe(1); expect(await e.finish(manager)).toMatchObject({ kind: 'released' });
  expect(watch).toHaveBeenCalledOnce(); expect(w.close).toHaveBeenCalledOnce();
});

it('releases safe unstarted setup without creating a runtime if the initial scan fails', async () => {
  const e = await f.setup(); const w = watchFixture(false); const manager = e.create({ guard: { watch: () => w.watch } });
  await e.accepted(manager);
  expect(await manager.drive(scope(e.offer), operation())).toEqual({ kind: 'released', collection: 'failed' });
  expect((await manager.inspect(scope(e.offer))).allocation).toMatchObject({ status: 'released', aborted: true });
  expect(e.backend.creates).toBe(0); expect(w.close).toHaveBeenCalledOnce();
});

it('cancels before first readiness and keeps shutdown pending through the original watch close', async () => {
  const e = await f.setup(); const original = deferred<void>(); const w = watchFixture(null, original.promise);
  const watch = vi.fn(() => w.watch); const manager = e.create({ guard: { watch } }); await e.accepted(manager);
  const driving = manager.drive(scope(e.offer), operation());
  let closing: Promise<void> | undefined;
  try {
    await vi.waitFor(() => { expect(watch).toHaveBeenCalledOnce(); });
    await manager.cancel(scope(e.offer)); let closed = false;
    closing = manager.close(); void closing.then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false); expect(e.backend.creates).toBe(0);
  } finally { original.resolve(); }
  await driving; await closing; expect(w.close).toHaveBeenCalledOnce();
});

it('owns and closes a watch returned by a callback that synchronously closes the installation', async () => {
  const e = await f.setup(); const w = watchFixture(); let closing: Promise<void> | undefined;
  const manager: InstallationController = e.create({ guard: { watch() { closing = manager.close(); return w.watch; } } });
  await e.accepted(manager);
  await expect(manager.drive(scope(e.offer), operation())).rejects.toMatchObject({ reason: 'closed' });
  await closing; expect(w.close).toHaveBeenCalledOnce(); expect(e.backend.creates).toBe(0);
});

it('refuses clean shutdown if a watch original cleanup fails', async () => {
  const e = await f.setup(); let fail!: (error: Error) => void;
  const original = new Promise<void>((_resolve, reject) => { fail = reject; });
  const w = watchFixture(false, original);
  const manager = e.create({ guard: { watch: () => w.watch } }); await e.accepted(manager);
  const driving = manager.drive(scope(e.offer), operation());
  const rejected = expect(driving).rejects.toMatchObject({ reason: 'cleanup' });
  await vi.waitFor(() => { expect(w.close).toHaveBeenCalledOnce(); });
  // The rejected original is retained by the manager; a synthetic rejection creates no kernel resource.
  fail(new Error('synthetic watch cleanup')); await rejected;
  await expect(manager.close()).rejects.toMatchObject({ reason: 'cleanup' });
});

it('attaches failed recovery monitoring and stops claimed work without staging or another execution', async () => {
  const e = await f.setup(); const first = e.create(); await e.accepted(first);
  await first.drive(scope(e.offer), operation()); expect(e.backend.starts).toBe(1); e.time.advance(1);
  await f.close(e.owner); const journal = await f.open(e.journalPath);
  const recovered = controlled(journal, e.time, e.backend); const w = watchFixture(false);
  const prepare = vi.fn(); const manager = e.create({ journal, supervisor: recovered.manager,
    guard: { watch: () => w.watch }, stagerFor: () => ({ prepare }) });
  await manager.drive(scope(e.offer), operation());
  expect(await journal.supervision({ key: scope(e.offer), now: e.time.wall() }))
    .toMatchObject({ cancelReason: 'artifact_incomplete', immediateStop: true });
  expect(await e.finish(manager)).toEqual({ kind: 'released', collection: 'failed' });
  expect(e.backend.kills).toBeGreaterThan(0); expect(e.backend.starts).toBe(1); expect(prepare).not.toHaveBeenCalled();
});
