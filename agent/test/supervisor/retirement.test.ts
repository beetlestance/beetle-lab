import { expect, it, vi } from 'vitest';
import { JournalError } from '../../src/journal/index.js';
import type { Journal } from '../../src/journal/index.js';
import type { LaunchInput } from '../../src/supervisor/index.js';
import { controlled, deferred, port, reserved, supervisorFixture } from './fixtures.js';
const f = supervisorFixture();

async function release(journal: Journal, input: LaunchInput, at: number): Promise<void> {
  const current = reserved(await journal.admission({ kind: 'reservation', key: input.key }));
  if (!current.launchSettlement || !current.createToken || !current.runtimeId || !current.specDigest) throw new Error('Missing actual launch');
  await journal.admission({ kind: 'release', evidence: { authority: 'supervisor', key: input.key,
    createToken: current.createToken, runtimeId: current.runtimeId, specDigest: current.specDigest,
    launch: { epoch: current.launchEpoch, startToken: current.startToken, settlementId: current.launchSettlement.evidenceId },
    runtime: { state: 'stopped', source: 'supervisor', observedAt: at, evidenceId: 'synthetic-retirement-runtime' },
    collection: { state: 'failed', observedAt: at, evidenceId: 'synthetic-retirement-collection' } } });
}

it('readonly retirement fences new handles while an existing cancellation write and its private continuation finish', async () => {
  const s = await f.setup(); const base = port(s.journal); const gate = deferred<void>(); const entered = deferred<void>();
  const released = deferred<void>(); let hold = false;
  const journal = { ...base, supervision: async (input: Parameters<typeof base.supervision>[0]) => {
    const value = await base.supervision(input);
    if (hold && input.cancel) { hold = false; entered.resolve(); await gate.promise; }
    return value;
  }, get: async (key: Parameters<typeof base.get>[0]) => { await released.promise; return base.get(key); } };
  const c = controlled(journal, s.time); const actor = c.manager.actor(s.input); await actor.launch();
  c.backend.observation = c.backend.known('exited').value; s.time.advance(1); hold = true;
  const cancelling = actor.cancel(); await entered.promise;
  const inspection = vi.spyOn(c.backend, 'inspect'); const retirement = c.manager.retireReleased(s.input, { deadline: performance.now() + 5000 });
  try {
    await expect(actor.launch()).rejects.toMatchObject({ code: 'closed' });
    await expect(actor.reconcile()).rejects.toMatchObject({ code: 'closed' });
    await expect(actor.tick()).rejects.toMatchObject({ code: 'closed' });
    await expect(actor.cancel()).rejects.toMatchObject({ code: 'closed' });
    expect(inspection).not.toHaveBeenCalled(); expect(c.manager.size).toBe(1);
    gate.resolve(); await cancelling;
    expect(inspection).not.toHaveBeenCalled();
    await release(s.journal, s.input, s.time.wall() + 1);
    const before = await s.journal.get(s.input.key); const cursor = await s.journal.sourceCursors(s.input.key);
    released.resolve(); await retirement;
    expect(inspection).toHaveBeenCalledTimes(1); expect(c.manager.size).toBe(0);
    expect(await s.journal.get(s.input.key)).toEqual(before); expect(await s.journal.sourceCursors(s.input.key)).toEqual(cursor);
    expect(c.backend.creates).toBe(1); expect(c.backend.starts).toBe(1);
    await expect(actor.cancel()).rejects.toMatchObject({ code: 'closed' });
  } finally { gate.resolve(); released.resolve(); await Promise.allSettled([cancelling, retirement]); }
});

it('readonly retirement owns an existing inspect original and waits its completion before inspecting released custody', async () => {
  const s = await f.setup(); const released = deferred<void>(); const base = port(s.journal);
  const c = controlled({ ...base, get: async key => { await released.promise; return base.get(key); } }, s.time);
  const actor = c.manager.actor(s.input); await actor.launch(); s.time.advance(1);
  c.backend.observation = c.backend.known('exited').value;
  const gate = deferred<void>(); const entered = deferred<void>(); const inspect = c.backend.inspect.bind(c.backend);
  const inspection = vi.spyOn(c.backend, 'inspect').mockImplementationOnce(async (...args) => { entered.resolve(); await gate.promise; return inspect(...args); });
  const ticking = actor.tick(); await entered.promise;
  const retirement = c.manager.retireReleased(s.input, { deadline: performance.now() + 5000 });
  try {
    await new Promise<void>(resolve => setImmediate(resolve)); expect(inspection).toHaveBeenCalledTimes(1);
    gate.resolve(); await ticking; await release(s.journal, s.input, s.time.wall() + 1);
    const before = await s.journal.get(s.input.key); released.resolve(); await retirement;
    expect(inspection).toHaveBeenCalledTimes(2); expect(c.manager.size).toBe(0); expect(await s.journal.get(s.input.key)).toEqual(before);
  } finally { gate.resolve(); released.resolve(); await Promise.allSettled([ticking, retirement]); }
});

it('retains actual pending evidence and never inspects or retires it as cold released custody', async () => {
  const s = await f.setup(); const base = port(s.journal);
  const c = controlled({ ...base, appendSupervisor: async () => { throw new JournalError('queue_full'); } }, s.time);
  const actor = c.manager.actor(s.input); await expect(actor.launch()).rejects.toMatchObject({ code: 'journal_unavailable' });
  const inspection = vi.spyOn(c.backend, 'inspect');
  await expect(c.manager.retireReleased(s.input, { deadline: performance.now() + 5000 })).rejects.toMatchObject({ code: 'conflict' });
  await expect(c.manager.retireReleased(s.input, { deadline: performance.now() + 5000 })).rejects.toMatchObject({ code: 'conflict' });
  expect(inspection).not.toHaveBeenCalled(); expect(c.manager.size).toBe(1);
  expect((await s.journal.get(s.input.key)).admission).toEqual({ state: 'charged' });
});
