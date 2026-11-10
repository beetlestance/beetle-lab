import { expect, it, vi } from 'vitest';
import { deferred, fixture, operation, scope } from './fixtures.js';

const f = fixture();
it('refuses a fresh original despite catalogue drift without staging or engine effects', async () => {
  const e = await f.setup();
  const preflight = vi.fn(() => { throw new Error('synthetic catalogue unavailable'); });
  const stagerFor = vi.fn(() => { throw new Error('unexpected staging'); });
  const manager = e.create({ catalog: { ...e.catalog, preflight }, stagerFor });
  const snapshot = await manager.cancelOriginal(e.offer);
  expect(snapshot).toMatchObject({ cancelRequested: true,
    admission: { state: 'rejected', reason: 'cancelled' } });
  const late = await manager.enqueue(e.offer);
  expect(late).toEqual({ accepted: true, snapshot });
  expect(preflight).not.toHaveBeenCalled(); expect(stagerFor).not.toHaveBeenCalled();
  expect(e.backend.creates).toBe(0); expect(e.backend.starts).toBe(0);
});

it('signals existing execution but retains its charge until actual collection releases it', async () => {
  const e = await f.setup(); const manager = e.create(); await e.accepted(manager);
  await manager.drive(scope(e.offer), operation()); expect(e.backend.starts).toBe(1);
  const snapshot = await manager.cancelOriginal(e.offer);
  expect(snapshot.cancelRequested).toBe(true);
  expect((await manager.inspect(scope(e.offer))).allocation?.status).toBe('charged');
  const first = await e.owner.supervision({ key: scope(e.offer), now: e.time.wall() });
  e.time.advance(1); await manager.cancelOriginal(e.offer);
  expect(await e.owner.supervision({ key: scope(e.offer), now: e.time.wall() }))
    .toMatchObject({ cancelRequestedAt: first.cancelRequestedAt, cancelReason: 'cancelled' });
  expect(await e.finish(manager)).toMatchObject({ kind: 'released' });
  expect(e.backend.starts).toBe(1);
});

it('retains an issued durable refusal through installation shutdown', async () => {
  const e = await f.setup(); const manager = e.create();
  const entered = deferred<void>(); const held = deferred<void>();
  const original = e.owner.cancelOriginal.bind(e.owner);
  vi.spyOn(e.owner, 'cancelOriginal').mockImplementation(async request => {
    const value = await original(request); entered.resolve(); await held.promise; return value;
  });
  const cancelling = manager.cancelOriginal(e.offer); await entered.promise;
  let closed = false; const closing = manager.close().then(() => { closed = true; });
  try {
    await new Promise<void>(resolve => setImmediate(resolve)); expect(closed).toBe(false);
  } finally { held.resolve(); }
  expect(await cancelling).toMatchObject({ cancelRequested: true,
    admission: { state: 'rejected', reason: 'cancelled' } });
  await closing; expect(closed).toBe(true);
});
