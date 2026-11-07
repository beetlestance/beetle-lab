import { describe, expect, it } from 'vitest';
import { prepareRuntime, runtimeName } from '../../src/backends/docker/index.js';
import { Supervisor } from '../../src/supervisor/index.js';
import type { LaunchInput } from '../../src/supervisor/index.js';
import { makeInput } from '../backends/docker/fixtures.js';
import { controlled, deferred, installationId, port, supervisorFixture } from './fixtures.js';
const f = supervisorFixture();
function independentInput(index: number): LaunchInput {
  const input = makeInput();
  input.offer.attemptId = `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
  const name = runtimeName({ ...input.offer, installationId, generation: 1 });
  const plan = prepareRuntime({ ...input, staged: { input: `${input.profile.stagingRoot}/${name}/input`, output: `${input.profile.stagingRoot}/${name}/output` } });
  if (!plan.ok) throw new Error(plan.reason);
  return { key: { ...input.offer, generation: 1 }, plan: plan.value };
}
describe('immutable scoped actor ownership and bounded lifetime', () => {
  it('duplicate plan objects map to one actor and conflicting same-key specs fail before effects', async () => {
    const s = await f.setup(); const c = controlled(s.journal, s.time); const actor = c.manager.actor(s.input);
    expect(c.manager.actor({ key: { ...s.input.key }, plan: s.plan })).toBe(actor);
    const source = makeInput(); source.offer = s.offer; source.manifest.minimumBudget = { ...s.offer.budget };
    const changed = prepareRuntime({ ...source, profile: { ...source.profile, maximumBudget: s.offer.budget, user: '10002:10002' },
      staged: { input: s.plan.spec.HostConfig.Mounts[0]!.Source, output: s.plan.spec.HostConfig.Mounts[1]!.Source } });
    if (!changed.ok) throw new Error(changed.reason);
    expect(() => c.manager.actor({ ...s.input, plan: changed.value })).toThrow('Supervisor conflict');
    expect(c.backend.creates).toBe(0);
  });
  it('scope/generation/install label mismatch and non-genuine runtime plan fail before effects', async () => {
    const s = await f.setup(); const c = controlled(s.journal, s.time);
    for (const key of [{ ...s.input.key, generation: 2 }, { ...s.input.key, organizationId: '00000000-0000-4000-8000-000000000099' }]) {
      expect(() => c.manager.actor({ ...s.input, key })).toThrow('Supervisor conflict');
    }
    expect(() => c.manager.actor({ ...s.input, plan: { ...s.plan } })).toThrow('Supervisor invalid_input');
    const wrong = new Supervisor({ journal: s.journal, installationId: '00000000-0000-4000-8000-000000000099', clock: s.time, backendFactory: () => c.backend });
    expect(() => wrong.actor(s.input)).toThrow('Supervisor conflict');
    expect(c.backend.creates).toBe(0);
  });
  it('Docker-normalized UUID casing collides while exact journal spelling is preserved', async () => {
    const s = await f.setup(); const c = controlled(s.journal, s.time);
    const input = independentInput(0xabc);
    const actor = c.manager.actor(input);
    const upper = { ...input, key: { ...input.key, attemptId: input.key.attemptId.toUpperCase() } };
    expect(() => c.manager.actor(upper)).toThrow('Supervisor conflict');
    expect(actor.input.key.attemptId).toBe(input.key.attemptId);
    expect(Object.isFrozen(actor.input)).toBe(true); expect(Object.isFrozen(actor.input.key)).toBe(true);
  });
  it('caps live actors at64 and permits more historical attempts through quiescent retirement', async () => {
    const s = await f.setup(); let allocations = 0; const c = controlled(s.journal, s.time);
    const manager = new Supervisor({ journal: s.journal, installationId, clock: s.time, backendFactory: () => { allocations++; return c.backend; } });
    const inputs = Array.from({ length: 65 }, (_, index) => independentInput(index + 1));
    for (const input of inputs.slice(0, 64)) manager.actor(input);
    expect(manager.size).toBe(64); expect(() => manager.actor(inputs[64]!)).toThrow('Supervisor capacity'); expect(allocations).toBe(64);
    const first = manager.actor(inputs[0]!); manager.retire(inputs[0]!);
    await expect(first.launch()).rejects.toMatchObject({ code: 'closed' });
    manager.actor(inputs[64]!); expect(manager.size).toBe(64); expect(allocations).toBe(65);
  });
  it('retirement blocks in-flight claim callbacks and old handles cannot dispatch later', async () => {
    const s = await f.setup(); const entered = deferred<void>(); const resume = deferred<void>();
    const c = controlled(port(s.journal, async input => {
      const result = await s.journal.admission(input);
      if (input.kind === 'claimCreate') { entered.resolve(); await resume.promise; }
      return result;
    }), s.time);
    const actor = c.manager.actor(s.input); const launch = actor.launch(); await entered.promise;
    expect(() => c.manager.retire(s.input)).toThrow('Supervisor conflict'); resume.resolve(); await launch;
    c.manager.retire(s.input); await expect(actor.tick()).rejects.toMatchObject({ code: 'closed' });
    await c.manager.actor(s.input).launch(); expect(c.backend.creates).toBe(1); expect(c.backend.starts).toBe(1);
  });
  it('changed offer intent fails before claimCreate/backend effects', async () => {
    const s = await f.setup(); const base = port(s.journal);
    const c = controlled({ ...base, readOffer: async key => ({ ...await base.readOffer(key), intentDigest: 'c'.repeat(64) }) }, s.time);
    await expect(c.manager.actor(s.input).launch()).rejects.toMatchObject({ code: 'conflict' });
    expect(c.backend.creates).toBe(0); expect(c.backend.starts).toBe(0);
  });
  it('backend allocation exception has a fixed safe typed message', async () => {
    const s = await f.setup(); const manager = new Supervisor({ journal: s.journal, installationId,
      backendFactory: () => { throw new Error('private credentials'); } });
    expect(() => manager.actor(s.input)).toThrow('Supervisor backend_unavailable'); expect(manager.size).toBe(0);
  });
});
