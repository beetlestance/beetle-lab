import { describe, expect, it } from 'vitest';
import { JournalError } from '../../src/journal/index.js';
import type { SupervisorInput } from '../../src/journal/index.js';
import { controlled, deferred, now, port, reserved, supervisorFixture } from './fixtures.js';

const f = supervisorFixture();
describe('termination remains available during evidence delivery failure', () => {
  it.each(['queue_full', 'quota_exceeded'] as const)('persistent %s cannot suppress stop or original-grace kill', async code => {
    const s = await f.setup(); const base = port(s.journal); let unavailable = true;
    const attempts: SupervisorInput[] = [];
    const c = controlled({ ...base, appendSupervisor: async input => {
      attempts.push(structuredClone(input));
      if (unavailable) throw new JournalError(code);
      return base.appendSupervisor(input);
    } }, s.time);
    c.backend.stopChangesState = false;
    const actor = c.manager.actor(s.input);
    await expect(actor.launch()).rejects.toMatchObject({ code: 'journal_unavailable' });
    await actor.cancel().catch(() => undefined);
    expect((await s.journal.get(s.input.key)).cancelRequested).toBe(true);
    expect(c.backend.stops.length).toBeGreaterThan(0);
    const deadline = c.backend.stops[0];
    s.time.advance(4999); await actor.cancel().catch(() => undefined);
    expect(c.backend.kills).toBe(0); expect(c.backend.stops.every(value => value === deadline)).toBe(true);
    s.time.advance(1); await actor.tick().catch(() => undefined);
    expect(c.backend.kills).toBe(1);
    expect(reserved(await s.journal.admission({ kind: 'reservation', key: s.input.key })).launchSettlement).toBeNull();
    unavailable = false; s.time.advance(200);
    await actor.tick();
    const events = (await s.journal.readEvents(s.input.key, 0)).events;
    expect(events.map(event => event.kind)).toEqual(['admitted', 'runtime.started', 'cancellation.requested', 'runtime.exited']);
    expect(events.slice(1).map(event => event.observedAt)).toEqual([now, now, now + 5000].map(value => new Date(value).toISOString()));
    expect(attempts.filter(input => input.event.kind === 'runtime.started').every(input => JSON.stringify(input) === JSON.stringify(attempts[0]))).toBe(true);
    expect(c.backend.starts).toBe(1);
    expect(reserved(await s.journal.admission({ kind: 'reservation', key: s.input.key })).launchSettlement?.disposition).toBe('completed');
  });
  it('real SQLite spool quota blocks settlement but not durable cancellation and termination', async () => {
    const s = await f.setup(undefined, 1, undefined, 2048); const base = port(s.journal);
    const codes: string[] = []; const delivered: SupervisorInput[] = [];
    const c = controlled({ ...base, appendSupervisor: async input => {
      try { const event = await base.appendSupervisor(input); delivered.push(structuredClone(input)); return event; }
      catch (error) { if (error instanceof JournalError) codes.push(error.code); throw error; }
    } }, s.time);
    c.backend.stopChangesState = false; const actor = c.manager.actor(s.input);
    await expect(actor.launch()).rejects.toMatchObject({ code: 'journal_unavailable' });
    expect(codes).toContain('quota_exceeded');
    await actor.cancel().catch(() => undefined);
    expect((await s.journal.get(s.input.key)).cancelRequested).toBe(true);
    expect(c.backend.stops.length).toBeGreaterThan(0);
    s.time.advance(5000); await actor.tick().catch(() => undefined); expect(c.backend.kills).toBe(1);
    expect(reserved(await s.journal.admission({ kind: 'reservation', key: s.input.key })).launchSettlement).toBeNull();
    for (let index = 0; index < 3 && delivered.length < 3; index++) {
      const { lastSeq } = await s.journal.get(s.input.key);
      await s.journal.acknowledge({ protocolVersion: '1.0', ...s.input.key, throughSeq: lastSeq });
      await s.journal.prune(s.input.key);
      await actor.tick().catch(() => undefined);
      if (delivered.length < 3) expect(reserved(await s.journal.admission({ kind: 'reservation', key: s.input.key })).launchSettlement).toBeNull();
    }
    expect(delivered.map(input => input.event.kind)).toEqual(['runtime.started', 'cancellation.requested', 'runtime.exited']);
    expect(delivered.map(input => input.sourceOrdinal)).toEqual([2, 3, 4]);
    expect(delivered.map(input => input.event.observedAt)).toEqual([now, now, now + 5000].map(value => new Date(value).toISOString()));
    expect(c.backend.starts).toBe(1);
    expect(reserved(await s.journal.admission({ kind: 'reservation', key: s.input.key })).launchSettlement?.disposition).toBe('completed');
  });
  it.each(['cancellation.requested', 'runtime.exited'] as const)('%s append failure cannot suppress signals or certify pending evidence', async kind => {
    const s = await f.setup(); const base = port(s.journal); let unavailable = true;
    const c = controlled({ ...base, appendSupervisor: input => {
      if (unavailable && input.event.kind === kind) return Promise.reject(new JournalError('quota_exceeded'));
      return base.appendSupervisor(input);
    } }, s.time);
    c.backend.startHold = deferred(); c.backend.stopChangesState = kind === 'runtime.exited';
    const actor = c.manager.actor(s.input);
    const launch = actor.launch().catch(error => error);
    await expect.poll(() => c.backend.starts).toBe(1);
    const cancel = actor.cancel().catch(error => error);
    await expect.poll(async () => (await s.journal.get(s.input.key)).cancelRequested).toBe(true);
    c.backend.startHold.resolve(c.backend.known('running'));
    expect(await launch).toMatchObject({ code: 'journal_unavailable' });
    expect(await cancel).toMatchObject({ code: 'journal_unavailable' });
    expect(c.backend.stops.length).toBeGreaterThan(0);
    expect(() => c.manager.retire(s.input)).toThrow('Supervisor conflict');
    expect(reserved(await s.journal.admission({ kind: 'reservation', key: s.input.key })).launchSettlement).toBeNull();
    s.time.advance(5000); await actor.tick().catch(() => undefined); expect(c.backend.kills).toBe(1);
    unavailable = false; await actor.tick();
    expect((await s.journal.readEvents(s.input.key, 0)).events.map(event => event.kind))
      .toEqual(['admitted', 'runtime.started', 'cancellation.requested', 'runtime.exited']);
    expect(reserved(await s.journal.admission({ kind: 'reservation', key: s.input.key })).launchSettlement?.disposition).toBe('completed');
  });
  it.each(['runtime.started', 'cancellation.requested', 'runtime.exited'] as const)('lost %s responses retain exact payload/ordinal through termination and recovery', async kind => {
    const s = await f.setup(); const base = port(s.journal); let unavailable = true;
    const attempts: SupervisorInput[] = [];
    const c = controlled({ ...base, appendSupervisor: async input => {
      attempts.push(structuredClone(input));
      const result = await base.appendSupervisor(input);
      if (unavailable && input.event.kind === kind) throw new JournalError('unavailable');
      return result;
    } }, s.time);
    c.backend.startHold = deferred(); const actor = c.manager.actor(s.input);
    const launch = actor.launch().catch(error => error);
    await expect.poll(() => c.backend.starts).toBe(1);
    const cancel = actor.cancel().catch(error => error);
    await expect.poll(async () => (await s.journal.get(s.input.key)).cancelRequested).toBe(true);
    c.backend.startHold.resolve(c.backend.known('running'));
    expect(await launch).toMatchObject({ code: 'journal_unavailable' });
    expect(await cancel).toMatchObject({ code: 'journal_unavailable' });
    s.time.advance(5000); await actor.tick().catch(() => undefined); expect(c.backend.kills).toBe(1);
    expect(reserved(await s.journal.admission({ kind: 'reservation', key: s.input.key })).launchSettlement).toBeNull();
    c.backend.observation = { state: 'unknown', reason: 'unavailable' };
    unavailable = false; await actor.tick();
    const events = (await s.journal.readEvents(s.input.key, 0)).events;
    expect(events.map(event => event.kind)).toEqual(['admitted', 'runtime.started', 'cancellation.requested', 'runtime.exited']);
    expect(events.map(event => event.seq)).toEqual([1, 2, 3, 4]);
    expect(events.slice(1).every(event => event.observedAt === new Date(now).toISOString())).toBe(true);
    const retried = attempts.filter(input => input.event.kind === kind);
    expect(retried.length).toBeGreaterThan(1);
    expect(retried.every(input => JSON.stringify(input) === JSON.stringify(retried[0]))).toBe(true);
    expect(c.backend.starts).toBe(1);
    expect(reserved(await s.journal.admission({ kind: 'reservation', key: s.input.key })).launchSettlement?.disposition).toBe('completed');
  });
});
