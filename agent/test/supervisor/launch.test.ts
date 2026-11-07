import { describe, expect, it } from 'vitest';
import { DockerBackend } from '../../src/backends/docker/index.js';
import { Supervisor } from '../../src/supervisor/index.js';
import { payload, unavailable } from '../backends/docker/fixtures.js';
import { controlled, deferred, id, installationId, now, port, reserved, supervisorFixture } from './fixtures.js';

const f = supervisorFixture();
describe('journal to Docker single dispatch', () => {
  it('persists claims/binding before each actual Docker mutation and orders durable evidence', async () => {
    const s = await f.setup();
    const original = s.transport.intercept;
    s.transport.intercept = async request => {
      if (request.path.includes('/create') || request.path.endsWith('/start')) {
        const row = reserved(await s.journal.admission({ kind: 'reservation', key: s.input.key }));
        expect(row.createToken).not.toBeNull(); expect(row.specDigest).toBe(s.plan.specDigest);
        if (request.path.endsWith('/start')) { expect(row.runtimeId).toBe(id); expect(row.startToken).not.toBeNull(); }
      }
      return original?.(request) ?? s.transport.respond(request);
    };
    const actor = s.manager.actor(s.input);
    const results = await Promise.all(Array.from({ length: 20 }, () => actor.launch()));
    expect(results.every(result => result.launch === 'completed')).toBe(true);
    await actor.launch(); await actor.tick();
    expect(s.transport.mutations().map(request => request.path)).toEqual([
      `/v1.47/containers/create?name=${s.plan.name}`, `/v1.47/containers/${id}/start`,
    ]);
    const row = reserved(await s.journal.admission({ kind: 'reservation', key: s.input.key }));
    expect(row).toMatchObject({ status: 'charged', launchClosed: true, launchSettlement: { disposition: 'completed' } });
    const events = await s.journal.readEvents(s.input.key, 0);
    expect(events.events.map(event => event.kind)).toEqual(['admitted', 'runtime.started']);
    expect(events.events.map(event => event.seq)).toEqual([1, 2]);
  });
  it.each(['claimCreate', 'claimStart'] as const)('fails closed on unknown %s journal outcome', async kind => {
    const s = await f.setup();
    const c = controlled(port(s.journal, async input => {
      const value = await s.journal.admission(input);
      if (input.kind === kind) throw new Error('secret canary must not escape');
      return value;
    }), s.time);
    await expect(c.manager.actor(s.input).launch()).rejects.toMatchObject({ code: 'journal_unavailable', message: 'Supervisor journal_unavailable' });
    expect(c.backend.creates).toBe(kind === 'claimCreate' ? 0 : 1); expect(c.backend.starts).toBe(0);
    const recovered = controlled(s.journal, s.time, c.backend);
    await recovered.manager.actor(s.input).launch();
    expect(c.backend.creates).toBe(kind === 'claimCreate' ? 0 : 1); expect(c.backend.starts).toBe(0);
    expect(reserved(await s.journal.admission({ kind: 'reservation', key: s.input.key })).status).toBe('charged');
  });
  it('lost Docker start response never replays target load after actor replacement', async () => {
    const s = await f.setup(); let loads = 0;
    s.transport.intercept = request => {
      if (!request.path.endsWith('/start')) return s.transport.respond(request);
      loads++; s.transport.respond(request); return unavailable();
    };
    const actor = s.manager.actor(s.input); expect((await actor.launch()).launch).toBe('unknown');
    s.manager.retire(s.input);
    expect((await s.manager.actor(s.input).launch()).observation).toMatchObject({ state: 'running', id });
    expect(loads).toBe(1);
    const row = reserved(await s.journal.admission({ kind: 'reservation', key: s.input.key }));
    expect(row.launchSettlement?.disposition).toBe('unknown'); expect(row.status).toBe('charged');
  });
  it('lost create response inspects and binds but cannot start or claim a definitive settlement', async () => {
    const s = await f.setup();
    s.transport.intercept = request => {
      if (!request.path.includes('/create')) return s.transport.respond(request);
      s.transport.respond(request); return unavailable();
    };
    const result = await s.manager.actor(s.input).launch();
    expect(result).toMatchObject({ launch: 'unknown', observation: { state: 'created', id } });
    s.manager.retire(s.input); await s.manager.actor(s.input).launch();
    expect(s.transport.mutations().filter(call => call.path.includes('/create'))).toHaveLength(1);
    expect(s.transport.mutations().filter(call => call.path.endsWith('/start'))).toHaveLength(0);
  });
  it.each(['running', 'exited'] as const)('recovery of %s does not dispatch start or infer outcome', async state => {
    const s = await f.setup();
    await s.journal.admission({ kind: 'claimCreate', key: s.input.key, specDigest: s.plan.specDigest });
    s.transport.state = payload(s.plan, state);
    const actor = s.manager.actor(s.input); const result = await actor.launch();
    expect(result).toMatchObject({ launch: 'unknown', observation: { state, id } });
    expect(s.transport.mutations()).toHaveLength(0);
    const row = reserved(await s.journal.admission({ kind: 'reservation', key: s.input.key }));
    expect(row.launchSettlement).toBeNull(); expect(row.status).toBe('charged');
  });
  it('late start claim response after durable cancellation retires its local dispatch capability', async () => {
    const s = await f.setup(); const entered = deferred<void>(); const resume = deferred<void>();
    const c = controlled(port(s.journal, async input => {
      const value = await s.journal.admission(input);
      if (input.kind === 'claimStart') { entered.resolve(); await resume.promise; }
      return value;
    }), s.time);
    const actor = c.manager.actor(s.input); const launch = actor.launch(); await entered.promise;
    const cancel = actor.cancel();
    await expect.poll(async () => (await s.journal.get(s.input.key)).cancelRequested).toBe(true);
    expect(c.backend.starts).toBe(0); expect(c.backend.stops).toHaveLength(0);
    resume.resolve(); await Promise.all([launch, cancel]);
    expect(c.backend.starts).toBe(0);
    expect(reserved(await s.journal.admission({ kind: 'reservation', key: s.input.key })).launchSettlement)
      .toMatchObject({ epoch: 1, disposition: 'retired' });
  });
  it('late create claim callback after cancel cannot create', async () => {
    const s = await f.setup(); const entered = deferred<void>(); const resume = deferred<void>();
    const c = controlled(port(s.journal, async input => {
      const value = await s.journal.admission(input);
      if (input.kind === 'claimCreate') { entered.resolve(); await resume.promise; }
      return value;
    }), s.time);
    const actor = c.manager.actor(s.input); const launch = actor.launch(); await entered.promise;
    const cancel = actor.cancel(); await expect.poll(async () => (await s.journal.get(s.input.key)).cancelRequested).toBe(true);
    resume.resolve(); await Promise.all([launch, cancel]);
    expect(c.backend.creates).toBe(0); expect(c.backend.starts).toBe(0);
  });
  it('runtime identity mismatch is a fixed conflict and cannot start', async () => {
    const s = await f.setup();
    const create = await s.journal.admission({ kind: 'claimCreate', key: s.input.key, specDigest: s.plan.specDigest });
    if (!('token' in create)) throw new Error('claim');
    await s.journal.admission({ kind: 'bindRuntime', key: s.input.key, specDigest: s.plan.specDigest, createToken: create.token, runtimeId: 'a'.repeat(64) });
    s.transport.state = payload(s.plan);
    await expect(s.manager.actor(s.input).launch()).rejects.toMatchObject({ code: 'conflict' });
    expect(s.transport.mutations()).toHaveLength(0);
  });
  it('real backend receives monotonic execution deadlines', async () => {
    const s = await f.setup(); const deadlines: number[] = [];
    const manager = new Supervisor({ journal: s.journal, installationId, clock: s.time, backendFactory: () => {
      const backend = new DockerBackend(s.transport);
      return { inspect: backend.inspect.bind(backend), stop: backend.stop.bind(backend), kill: backend.kill.bind(backend),
        ensureCreated: (plan, op) => { deadlines.push(op.deadline); return backend.ensureCreated(plan, op); },
        dispatchStartOnce: (plan, op) => { deadlines.push(op.deadline); return backend.dispatchStartOnce(plan, op); } };
    } });
    await manager.actor(s.input).launch();
    expect(deadlines).toEqual([s.time.monotonic() + 1000, s.time.monotonic() + 1000]);
    expect(deadlines.every(value => value !== now + 1000)).toBe(true);
  });
});
