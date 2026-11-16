import { expect, it } from 'vitest';
import { deferred, fixture, operation, scope } from './fixtures.js';

const f = fixture();

it('composes private output stop through durable intent, actor kill and output reconciliation', async () => {
  const e = await f.setup(); const manager = e.create(); await e.accepted(manager);
  await manager.drive(scope(e.offer), operation()); expect(e.backend.starts).toBe(1);
  await manager.stop(scope(e.offer), 'output_limit');
  await manager.cancel(scope(e.offer));
  expect(await e.owner.supervision({ key: scope(e.offer), now: e.time.wall() }))
    .toMatchObject({ cancelRequested: true, cancelReason: 'output_limit' });
  expect(await e.finish(manager)).toEqual({ kind: 'released', collection: 'failed' });
  expect(e.backend.kills).toBeGreaterThan(0); expect(e.backend.stops).toHaveLength(0);
  expect((await e.owner.readEvents(scope(e.offer), 0)).events.find(event => event.kind === 'runtime.exited'))
    .toMatchObject({ payload: { reason: 'output_limit' } });
  expect(e.backend.starts).toBe(1);
});

it('rejects a user-provided reason on the guard-only stop port before creating intent', async () => {
  const e = await f.setup(); const manager = e.create(); await e.accepted(manager);
  await expect(manager.stop(scope(e.offer), 'cancelled' as 'output_limit')).rejects.toMatchObject({ reason: 'invalid_input' });
  expect((await manager.inspect(scope(e.offer))).snapshot.cancelRequested).toBe(false);
  expect(e.backend.creates).toBe(0);
});

it('escalates an already-signalled user stop through the manager/controller cached lanes', async () => {
  const e = await f.setup(); const manager = e.create(); await e.accepted(manager);
  e.backend.stopChangesState = false; await manager.drive(scope(e.offer), operation());
  await manager.cancel(scope(e.offer)); await expect.poll(() => e.backend.stops.length).toBeGreaterThan(0);
  expect(e.backend.kills).toBe(0);
  await manager.stop(scope(e.offer), 'output_limit'); await expect.poll(() => e.backend.kills).toBeGreaterThan(0);
  expect(await e.owner.supervision({ key: scope(e.offer), now: e.time.wall() }))
    .toMatchObject({ cancelReason: 'cancelled', immediateStop: true });
  expect(await e.finish(manager)).toEqual({ kind: 'released', collection: 'failed' });
  expect(e.backend.starts).toBe(1);
});

it('retains urgent intent through manager/controller cancellation while start is outstanding', async () => {
  const e = await f.setup(); const manager = e.create(); await e.accepted(manager);
  e.backend.startHold = deferred();
  const driving = manager.drive(scope(e.offer), operation());
  await expect.poll(() => e.backend.starts).toBe(1);
  await manager.cancel(scope(e.offer)); await manager.stop(scope(e.offer), 'output_limit');
  expect(await e.owner.supervision({ key: scope(e.offer), now: e.time.wall() }))
    .toMatchObject({ cancelReason: 'cancelled', immediateStop: true });
  expect(e.backend.kills).toBe(0);
  e.backend.startHold.resolve(e.backend.known('running')); await driving;
  expect(await e.finish(manager)).toEqual({ kind: 'released', collection: 'failed' });
  expect(e.backend.kills).toBeGreaterThan(0); expect(e.backend.stops).toHaveLength(0);
  expect(e.backend.starts).toBe(1);
});
