import { describe, expect, it } from 'vitest';
import { ControlledBackend, controlled, deferred, id, now, port, reserved, supervisorFixture } from './fixtures.js';

const f = supervisorFixture();
describe('durable cancellation independent of launch work', () => {
  it('persists during held create, then retires start and stops only after create resolves', async () => {
    const s = await f.setup(); const c = controlled(s.journal, s.time);
    c.backend.createHold = deferred();
    const actor = c.manager.actor(s.input); const launch = actor.launch();
    await expect.poll(() => c.backend.creates).toBe(1);
    const cancel = actor.cancel();
    await expect.poll(async () => (await s.journal.get(s.input.key)).cancelRequested).toBe(true);
    expect(c.backend.stops).toHaveLength(0); expect(c.backend.kills).toBe(0);
    expect(() => c.manager.retire(s.input)).toThrow('Supervisor conflict');
    c.backend.createHold.resolve(c.backend.known('created'));
    await Promise.all([launch, cancel]);
    expect(c.backend.starts).toBe(0);
    expect(reserved(await s.journal.admission({ kind: 'reservation', key: s.input.key })).launchSettlement?.disposition).toBe('retired');
    expect((await s.journal.readEvents(s.input.key, 0)).events.map(event => event.kind))
      .toEqual(['admitted', 'cancellation.requested']);
  });
  it('persists during held start and cannot settle or stop before its actual completion', async () => {
    const s = await f.setup(); const c = controlled(s.journal, s.time);
    c.backend.startHold = deferred();
    const actor = c.manager.actor(s.input); const launch = actor.launch();
    await expect.poll(() => c.backend.starts).toBe(1);
    const cancel = actor.cancel();
    await expect.poll(async () => (await s.journal.get(s.input.key)).cancelRequested).toBe(true);
    expect(c.backend.stops).toHaveLength(0); expect(c.backend.kills).toBe(0);
    expect(reserved(await s.journal.admission({ kind: 'reservation', key: s.input.key })).launchSettlement).toBeNull();
    c.backend.startHold.resolve(c.backend.known('running'));
    await Promise.all([launch, cancel]);
    expect(c.backend.starts).toBe(1);
    expect(reserved(await s.journal.admission({ kind: 'reservation', key: s.input.key })).launchSettlement?.disposition).toBe('completed');
    expect((await s.journal.readEvents(s.input.key, 0)).events.map(event => event.kind))
      .toEqual(['admitted', 'runtime.started', 'cancellation.requested', 'runtime.exited']);
  });
  it('first durable five-second grace survives repeated cancel, retirement and recovery', async () => {
    const s = await f.setup(); const c = controlled(s.journal, s.time);
    c.backend.stopChangesState = false;
    const actor = c.manager.actor(s.input); await actor.launch(); await actor.cancel();
    const first = c.backend.stops[0]; expect(first).toBe(s.time.monotonic() + 5000);
    s.time.advance(2000); await actor.cancel();
    expect(c.backend.stops.every(value => value === first)).toBe(true); expect(c.backend.kills).toBe(0);
    c.manager.retire(s.input);
    const next = controlled(s.journal, s.time, c.backend); const recovered = next.manager.actor(s.input);
    await recovered.tick(); expect(c.backend.stops.at(-1)).toBe(first);
    s.time.advance(2999); await recovered.tick(); expect(c.backend.kills).toBe(0);
    s.time.advance(1); await recovered.tick(); expect(c.backend.kills).toBe(1);
    expect(reserved(await s.journal.admission({ kind: 'reservation', key: s.input.key })).status).toBe('charged');
  });
  it('monotonic grace expires even when wall time stops advancing', async () => {
    const s = await f.setup(); const c = controlled(s.journal, s.time); c.backend.stopChangesState = false;
    const actor = c.manager.actor(s.input); await actor.launch(); await actor.cancel();
    s.time.monoOnly(s.time.monotonic() + 5000); await actor.tick(); expect(c.backend.kills).toBe(1);
  });
  it('absolute timeout persists cancellation without resetting the admission deadline', async () => {
    const s = await f.setup(); const c = controlled(s.journal, s.time); c.backend.stopChangesState = false;
    await c.manager.actor(s.input).launch(); c.manager.retire(s.input);
    s.time.advance(1000);
    const next = controlled(s.journal, s.time, c.backend); const actor = next.manager.actor(s.input);
    expect(await actor.tick()).toMatchObject({ cancellation: 'timeout' });
    const stamp = await s.journal.supervision({ key: s.input.key, now: now + 1000 });
    expect(stamp.cancelRequestedAt).toBe(now + 1000);
    s.time.advance(5000); await actor.tick(); expect(c.backend.kills).toBe(1); expect(c.backend.starts).toBe(1);
  });
  it('rollback is durably fenced and emergency termination is reported separately from normal grace', async () => {
    const s = await f.setup(); const c = controlled(s.journal, s.time); await c.manager.actor(s.input).launch();
    s.time.wallOnly(now - 1);
    const result = await c.manager.actor(s.input).tick();
    expect(result.cancellation).toBe('clock_integrity'); expect(c.backend.kills).toBe(1); expect(c.backend.stops).toHaveLength(0);
    expect(await s.journal.supervision({ key: s.input.key, now })).toMatchObject({ clockFenced: true, cancelRequested: true });
  });
  it('invalid wall clock fences launch while durably requesting cancellation', async () => {
    const s = await f.setup(); s.time.wallOnly(Number.NaN); const c = controlled(s.journal, s.time);
    expect(await c.manager.actor(s.input).launch()).toMatchObject({ cancellation: 'clock_integrity' });
    expect(c.backend.creates).toBe(0); expect(c.backend.starts).toBe(0);
    expect((await s.journal.get(s.input.key)).cancelRequested).toBe(true);
  });
  it('clock read failure blocks new dispatch and cannot assert normal grace', async () => {
    const s = await f.setup(); const c = controlled({ ...port(s.journal), supervision: () => Promise.reject(new Error('secret')) }, s.time);
    await expect(c.manager.actor(s.input).launch()).rejects.toMatchObject({ code: 'journal_unavailable' });
    expect(c.backend.creates).toBe(0); expect(c.backend.starts).toBe(0); expect(c.backend.stops).toHaveLength(0);
  });
  it('durable cancel failure cannot signal and journal exceptions remain redacted', async () => {
    const s = await f.setup(); const base = port(s.journal);
    const c = controlled({ ...base, supervision: input => input.cancel ? Promise.reject(new Error('secret')) : base.supervision(input) }, s.time);
    const actor = c.manager.actor(s.input); await actor.launch();
    await expect(actor.cancel()).rejects.toMatchObject({ message: 'Supervisor journal_unavailable' });
    expect(c.backend.stops).toHaveLength(0); expect(c.backend.kills).toBe(0);
  });
  it('unknown start followed by exited observation stays unknown and charged', async () => {
    const s = await f.setup(); const backend = new ControlledBackend();
    backend.startResult = { outcome: 'unknown', reason: 'unavailable' };
    const c = controlled(s.journal, s.time, backend); const actor = c.manager.actor(s.input);
    expect((await actor.launch()).launch).toBe('unknown');
    backend.observation = { id, state: 'exited', exitCode: 137, oomKilled: false };
    const result = await actor.cancel(); expect(result.launch).toBe('unknown');
    const row = reserved(await s.journal.admission({ kind: 'reservation', key: s.input.key }));
    expect(row.launchSettlement?.disposition).toBe('unknown'); expect(row.status).toBe('charged');
    const events = await s.journal.readEvents(s.input.key, 0);
    const exit = events.events.find(event => event.kind === 'runtime.exited');
    expect(exit?.payload).toMatchObject({ exitCode: 137, oomKilled: false });
  });
});
