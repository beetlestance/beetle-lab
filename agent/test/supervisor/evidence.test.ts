import { describe, expect, it } from 'vitest';
import { controlled, id, now, port, reserved, supervisorFixture } from './fixtures.js';
const f = supervisorFixture();
describe('honest runtime evidence and admission identity', () => {
  it.each([0, 137])('exit%s without wrapper evidence never infers pass or OOM', async exitCode => {
    const s = await f.setup(); const c = controlled(s.journal, s.time);
    const actor = c.manager.actor(s.input); await actor.launch();
    c.backend.observation = { id, state: 'exited', exitCode, oomKilled: false };
    await actor.tick();
    const events = await s.journal.readEvents(s.input.key, 0);
    const exit = events.events.find(event => event.kind === 'runtime.exited');
    expect(exit?.payload).toEqual({ exitCode, oomKilled: false, observedAt: new Date(now).toISOString() });
    expect(events.events.some(event => event.kind === 'engine.result')).toBe(false);
    expect(reserved(await s.journal.admission({ kind: 'reservation', key: s.input.key })).status).toBe('charged');
    expect((await s.journal.get(s.input.key)).result).toBeUndefined();
  });
  it('only actual oomKilled evidence is recorded as memory_limit', async () => {
    const s = await f.setup(); const c = controlled(s.journal, s.time); const actor = c.manager.actor(s.input);
    await actor.launch(); c.backend.observation = { id, state: 'exited', exitCode: 137, oomKilled: true };
    await actor.tick();
    const exit = (await s.journal.readEvents(s.input.key, 0)).events.find(event => event.kind === 'runtime.exited');
    expect(exit?.payload).toMatchObject({ reason: 'memory_limit', oomKilled: true, exitCode: 137 });
  });
  it('runtime evidence is durable before completed settlement', async () => {
    const s = await f.setup(); let checked = false;
    const c = controlled(port(s.journal, async input => {
      if (input.kind === 'settleLaunch' && input.settlement.disposition === 'completed') {
        expect((await s.journal.readEvents(s.input.key, 0)).events.at(-1)?.kind).toBe('runtime.started'); checked = true;
      }
      return s.journal.admission(input);
    }), s.time);
    await c.manager.actor(s.input).launch(); expect(checked).toBe(true);
  });
  it('evidence-write failure cannot fabricate completed settlement or replay a second start', async () => {
    const s = await f.setup(); const base = port(s.journal);
    const c = controlled({ ...base, appendSupervisor: () => Promise.reject(new Error('private config')) }, s.time);
    const actor = c.manager.actor(s.input);
    await expect(actor.launch()).rejects.toMatchObject({ code: 'journal_unavailable' });
    expect(c.backend.starts).toBe(1);
    expect(reserved(await s.journal.admission({ kind: 'reservation', key: s.input.key })).launchSettlement).toBeNull();
    const next = controlled(s.journal, s.time, c.backend); await next.manager.actor(s.input).launch();
    expect(c.backend.starts).toBe(1);
    expect(reserved(await s.journal.admission({ kind: 'reservation', key: s.input.key })).launchSettlement).toBeNull();
  });
  it('stored spec mismatch fails before any backend operation', async () => {
    const s = await f.setup(); const c = controlled(s.journal, s.time);
    await s.journal.admission({ kind: 'claimCreate', key: s.input.key, specDigest: 'c'.repeat(64) });
    await expect(c.manager.actor(s.input).launch()).rejects.toMatchObject({ code: 'conflict' });
    expect(c.backend.creates).toBe(0); expect(c.backend.starts).toBe(0);
  });
  it('journal UUID spelling is preserved while Docker labels normalize it', async () => {
    const s = await f.setup(undefined, 1, offer => {
      offer.attemptId = '00000000-0000-4000-8000-00000000aBcD';
      offer.organizationId = '00000000-0000-4000-8000-00000000AbCd';
    });
    const c = controlled(s.journal, s.time); await c.manager.actor(s.input).launch();
    expect(s.plan.spec.Labels['dev.beetle.attempt']).toBe(s.offer.attemptId.toLowerCase());
    expect((await s.journal.readEvents(s.input.key, 0)).events.every(event => event.attemptId === s.offer.attemptId)).toBe(true);
    c.manager.retire(s.input);
    const lower = { ...s.input, key: { ...s.input.key, attemptId: s.offer.attemptId.toLowerCase() } };
    await expect(c.manager.actor(lower).launch()).rejects.toMatchObject({ code: 'journal_unavailable' });
    expect(c.backend.creates).toBe(1); expect(c.backend.starts).toBe(1);
  });
});
