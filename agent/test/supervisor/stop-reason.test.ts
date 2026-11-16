import { expect, it } from 'vitest';
import { controlled, deferred, port, supervisorFixture } from './fixtures.js';

const f = supervisorFixture();

it.each(['output_limit', 'artifact_incomplete'] as const)('kills%s immediately and preserves it through user cancel and recovery', async reason => {
  const s = await f.setup(); const c = controlled(s.journal, s.time); const actor = c.manager.actor(s.input);
  await actor.launch(); expect(await actor.cancel(reason)).toMatchObject({ cancellation: reason });
  expect(c.backend.kills).toBe(1); expect(c.backend.stops).toHaveLength(0);
  expect((await s.journal.readEvents(s.input.key, 0)).events.find(event => event.kind === 'runtime.exited'))
    .toMatchObject({ payload: { reason } });
  await actor.cancel(); c.manager.retire(s.input);
  const next = controlled(s.journal, s.time, c.backend);
  expect(await next.manager.actor(s.input).tick()).toMatchObject({ cancellation: reason });
  expect((await s.journal.supervision({ key: s.input.key, now: s.time.wall() })).cancelReason).toBe(reason);
  expect(c.backend.starts).toBe(1);
});

it('recovers a timeout as timeout rather than user cancellation without renewing grace', async () => {
  const s = await f.setup(); const c = controlled(s.journal, s.time); c.backend.stopChangesState = false;
  const actor = c.manager.actor(s.input); await actor.launch(); s.time.advance(1000); await actor.tick();
  const deadline = c.backend.stops[0]; c.manager.retire(s.input);
  const next = controlled(s.journal, s.time, c.backend);
  expect(await next.manager.actor(s.input).tick()).toMatchObject({ cancellation: 'timeout' });
  expect(c.backend.stops.at(-1)).toBe(deadline); expect(c.backend.kills).toBe(0);
  s.time.advance(5000); await next.manager.actor(s.input).tick(); expect(c.backend.kills).toBe(1);
});

it('escalates a prior user cancellation without relabelling and retains urgency during recovery', async () => {
  const s = await f.setup(); const c = controlled(s.journal, s.time); c.backend.stopChangesState = false;
  const actor = c.manager.actor(s.input); await actor.launch(); await actor.cancel();
  expect(c.backend.kills).toBe(0);
  expect(await actor.cancel('output_limit')).toMatchObject({ cancellation: 'cancelled' });
  expect(c.backend.kills).toBe(1);
  expect(await s.journal.supervision({ key: s.input.key, now: s.time.wall() }))
    .toMatchObject({ cancelReason: 'cancelled', immediateStop: true });
  c.manager.retire(s.input); const next = controlled(s.journal, s.time, c.backend);
  expect(await next.manager.actor(s.input).tick()).toMatchObject({ cancellation: 'cancelled' });
  expect(c.backend.starts).toBe(1);
});

it('persists escalation during a held start but never signals before the original start settles', async () => {
  const s = await f.setup(); const c = controlled(s.journal, s.time); c.backend.startHold = deferred();
  const actor = c.manager.actor(s.input); const launch = actor.launch();
  await expect.poll(() => c.backend.starts).toBe(1);
  const user = actor.cancel();
  await expect.poll(async () => (await s.journal.supervision({ key: s.input.key, now: s.time.wall() })).cancelReason).toBe('cancelled');
  const guard = actor.cancel('output_limit');
  await expect.poll(async () => (await s.journal.supervision({ key: s.input.key, now: s.time.wall() })).immediateStop).toBe(true);
  expect(c.backend.kills).toBe(0); expect(c.backend.stops).toHaveLength(0);
  c.backend.startHold.resolve(c.backend.known('running')); await Promise.all([launch, user, guard]);
  expect(c.backend.kills).toBeGreaterThan(0); expect(c.backend.stops).toHaveLength(0);
  expect((await s.journal.supervision({ key: s.input.key, now: s.time.wall() })).cancelReason).toBe('cancelled');
});

it('retains one urgent follow-up while an original user-cancel response is held', async () => {
  const s = await f.setup(); const held = deferred<void>(); let waiting = false; let holdOnce = true;
  const wrapped = port(s.journal); const original = wrapped.supervision;
  wrapped.supervision = async input => {
    const state = await original(input);
    if (input.cancel && input.reason === 'cancelled' && holdOnce) {
      holdOnce = false; waiting = true; await held.promise;
    }
    return state;
  };
  const c = controlled(wrapped, s.time); const actor = c.manager.actor(s.input); await actor.launch();
  const user = actor.cancel(); await expect.poll(() => waiting).toBe(true);
  const guard = actor.cancel('output_limit'); expect(() => c.manager.retire(s.input)).toThrow('conflict');
  held.resolve(); await Promise.all([user, guard]);
  expect(await s.journal.supervision({ key: s.input.key, now: s.time.wall() }))
    .toMatchObject({ cancelReason: 'cancelled', immediateStop: true });
  expect(c.backend.kills).toBeGreaterThan(0);
});

it('retains the primary output cause in exit evidence even when clock emergency changes signalling', async () => {
  const s = await f.setup(); const c = controlled(s.journal, s.time); const actor = c.manager.actor(s.input); await actor.launch();
  await s.journal.supervision({ key: s.input.key, now: s.time.wall(), cancel: true, reason: 'output_limit' });
  s.time.wallOnly(s.time.wall() - 1);
  expect(await actor.tick()).toMatchObject({ cancellation: 'clock_integrity' });
  expect((await s.journal.readEvents(s.input.key, 0)).events.find(event => event.kind === 'runtime.exited'))
    .toMatchObject({ payload: { reason: 'output_limit' } });
});

it('persists a clock-integrity emergency even when only the old process observed monotonic failure', async () => {
  const s = await f.setup(); const c = controlled(s.journal, s.time); const actor = c.manager.actor(s.input); await actor.launch();
  await actor.cancel('clock_integrity');
  expect(await s.journal.supervision({ key: s.input.key, now: s.time.wall() }))
    .toMatchObject({ cancelReason: 'clock_integrity', clockFenced: true, immediateStop: true });
  expect(c.backend.kills).toBe(1); expect(c.backend.stops).toHaveLength(0);
});
