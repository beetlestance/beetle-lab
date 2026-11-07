import { describe, expect, it } from 'vitest';
import { payload } from '../backends/docker/fixtures.js';
import { controlled, id, now, reserved, supervisorFixture } from './fixtures.js';

const f = supervisorFixture();
async function reopen(s: Awaited<ReturnType<typeof f.setup>>, path: string) {
  await f.close(s.journal); return f.open(path);
}
describe('exclusive journal crash-gap recovery', () => {
  it('reopen before any create claim permits exactly one launch', async () => {
    const path = f.path(); const s = await f.setup(path); const journal = await reopen(s, path);
    const c = controlled(journal, s.time); const actor = c.manager.actor(s.input);
    await actor.launch(); await actor.launch(); expect(c.backend.creates).toBe(1); expect(c.backend.starts).toBe(1);
  });
  it.each(['missing', 'created', 'running', 'exited'] as const)('reopen after create claim with %s cannot create or start', async state => {
    const path = f.path(); const s = await f.setup(path);
    await s.journal.admission({ kind: 'claimCreate', key: s.input.key, specDigest: s.plan.specDigest });
    const journal = await reopen(s, path); const c = controlled(journal, s.time);
    c.backend.observation = state === 'missing' ? { state } : c.backend.known(state).value;
    const result = await c.manager.actor(s.input).launch();
    expect(result).toMatchObject({ launch: 'unknown', observation: { state } });
    expect(c.backend.creates).toBe(0); expect(c.backend.starts).toBe(0);
    expect(reserved(await journal.admission({ kind: 'reservation', key: s.input.key })).status).toBe('charged');
  });
  it.each(['created', 'running', 'exited'] as const)('reopen after start claim with %s never upgrades unknown dispatch', async state => {
    const path = f.path(); const s = await f.setup(path);
    const create = await s.journal.admission({ kind: 'claimCreate', key: s.input.key, specDigest: s.plan.specDigest });
    if (!('token' in create)) throw new Error('claim');
    const binding = { key: s.input.key, specDigest: s.plan.specDigest, runtimeId: id, createToken: create.token };
    await s.journal.admission({ kind: 'bindRuntime', ...binding });
    await s.journal.admission({ kind: 'claimStart', ...binding, now });
    const journal = await reopen(s, path); const c = controlled(journal, s.time);
    c.backend.observation = c.backend.known(state).value;
    expect((await c.manager.actor(s.input).launch()).launch).toBe('unknown');
    expect(c.backend.creates).toBe(0); expect(c.backend.starts).toBe(0);
    expect(reserved(await journal.admission({ kind: 'reservation', key: s.input.key })).launchSettlement).toBeNull();
  });
  it('reopens completed launch and restores source ordinal stream without dispatch', async () => {
    const path = f.path(); const s = await f.setup(path); const c = controlled(s.journal, s.time);
    await c.manager.actor(s.input).launch();
    const journal = await reopen(s, path); const next = controlled(journal, s.time, c.backend);
    expect((await next.manager.actor(s.input).launch()).launch).toBe('completed');
    expect(c.backend.creates).toBe(1); expect(c.backend.starts).toBe(1);
    const events = await journal.readEvents(s.input.key, 0);
    expect(events.events.map(event => event.seq)).toEqual([1, 2, 3]);
    expect(await journal.sourceCursors(s.input.key)).toMatchObject({ supervisorOrdinal: 3 });
  });
  it('durable cancellation grace survives actual journal close and reopen', async () => {
    const path = f.path(); const s = await f.setup(path); const c = controlled(s.journal, s.time);
    c.backend.stopChangesState = false; const actor = c.manager.actor(s.input);
    await actor.launch(); await actor.cancel(); const deadline = c.backend.stops[0];
    const journal = await reopen(s, path); s.time.advance(4000);
    const next = controlled(journal, s.time, c.backend); const recovered = next.manager.actor(s.input);
    await recovered.tick(); expect(c.backend.stops.at(-1)).toBe(deadline); expect(c.backend.kills).toBe(0);
    s.time.advance(1000); await recovered.tick(); expect(c.backend.kills).toBe(1);
  });
  it('durable high-water catches rollback after restart even above admittedAt', async () => {
    const path = f.path(); const s = await f.setup(path); const c = controlled(s.journal, s.time);
    await c.manager.actor(s.input).launch(); s.time.advance(500); await c.manager.actor(s.input).tick();
    const journal = await reopen(s, path); s.time.wallOnly(now + 400);
    const next = controlled(journal, s.time, c.backend);
    expect((await next.manager.actor(s.input).tick()).cancellation).toBe('clock_integrity');
    expect(c.backend.kills).toBe(1);
  });
  it('mismatching Docker spec is unknown, charged, and never a replay permission', async () => {
    const s = await f.setup();
    await s.journal.admission({ kind: 'claimCreate', key: s.input.key, specDigest: s.plan.specDigest });
    s.transport.state = payload(s.plan);
    const config = s.transport.state.Config as { Labels: Record<string, string> };
    config.Labels['dev.beetle.intent'] = 'f'.repeat(64);
    const result = await s.manager.actor(s.input).launch();
    expect(result).toMatchObject({ launch: 'unknown', observation: { state: 'unknown', reason: 'conflict' } });
    expect(s.transport.mutations()).toHaveLength(0);
  });
  it('unknown Docker observation remains charged without starting a replacement', async () => {
    const s = await f.setup(); await s.journal.admission({ kind: 'claimCreate', key: s.input.key, specDigest: s.plan.specDigest });
    const c = controlled(s.journal, s.time); c.backend.observation = { state: 'unknown', reason: 'unavailable' };
    expect((await c.manager.actor(s.input).launch()).observation).toEqual(c.backend.observation);
    expect(c.backend.creates).toBe(0); expect(c.backend.starts).toBe(0);
  });
});
