import { describe, expect, it } from 'vitest';
import { JournalError } from '../../src/journal/index.js';
import { Supervisor } from '../../src/supervisor/index.js';
import { ControlledBackend, installationId, now, port, reserved, supervisorFixture } from './fixtures.js';

const f = supervisorFixture();
describe('review R1 durable action evidence', () => {
  it.each(['queue_full', 'quota_exceeded'] as const)('same actor must persist captured start after transient %s before completed settlement', async code => {
    const s = await f.setup(); const base = port(s.journal); let failed = false;
    const journal = { ...base, appendSupervisor: async (input: Parameters<typeof base.appendSupervisor>[0]) => {
      if (input.event.kind === 'runtime.started' && !failed) { failed = true; throw new JournalError(code); }
      return base.appendSupervisor(input);
    } };
    const backend = new ControlledBackend();
    const manager = new Supervisor({ journal, installationId, clock: s.time, backendFactory: () => backend });
    const actor = manager.actor(s.input); await expect(actor.launch()).rejects.toMatchObject({ code: 'journal_unavailable' });
    backend.observation = { state: 'unknown', reason: 'unavailable' };
    await actor.tick(); await actor.cancel();
    const row = reserved(await s.journal.admission({ kind: 'reservation', key: s.input.key }));
    const events = (await s.journal.readEvents(s.input.key, 0)).events;
    expect(events.some(event => event.kind === 'runtime.started')).toBe(true);
    expect(row.launchSettlement?.disposition).toBe('completed'); expect(backend.starts).toBe(1);
  });
  it.each(['queue_full', 'quota_exceeded'] as const)('persistent %s evidence failure cannot settle completed on same-actor cancel', async code => {
    const s = await f.setup(); const base = port(s.journal);
    const journal = { ...base, appendSupervisor: async (input: Parameters<typeof base.appendSupervisor>[0]) => {
      if (input.event.kind === 'runtime.started') throw new JournalError(code);
      return base.appendSupervisor(input);
    } };
    const backend = new ControlledBackend();
    const manager = new Supervisor({ journal, installationId, clock: s.time, backendFactory: () => backend });
    const actor = manager.actor(s.input); await expect(actor.launch()).rejects.toMatchObject({ code: 'journal_unavailable' });
    backend.observation = { state: 'unknown', reason: 'unavailable' };
    // Cancellation may report the persistent evidence failure; it must never mint proof.
    await actor.cancel().catch(() => undefined);
    const row = reserved(await s.journal.admission({ kind: 'reservation', key: s.input.key }));
    expect(row.launchSettlement?.disposition).not.toBe('completed');
    expect((await s.journal.get(s.input.key)).cancelRequested).toBe(true); expect(backend.starts).toBe(1);
  });
});

describe('review R1 final dispatch sample', () => {
  it.each([
    ['wall rollback in last permission read', 'wall', 2, now - 1],
    ['wall invalid in last permission read', 'wall', 2, Number.NaN],
    ['monotonic rollback in last permission read', 'mono', 2, -1],
    ['monotonic invalid during operation construction', 'mono', 3, Number.NaN],
    ['monotonic deadline crossing during operation construction', 'mono', 3, Infinity],
  ] as const)('%s never reaches backend after detection', async (_name, source, failAt, value) => {
    const s = await f.setup(); const base = port(s.journal); let armed = false; let walls = 0; let monos = 0;
    let faultSeen = false; let violations = 0; let deadlineCrossed = false;
    const baselineMono = s.time.monotonic();
    const clock = {
      wall() {
        if (armed && source === 'wall' && ++walls === failAt) { faultSeen = true; return value; }
        return s.time.wall();
      },
      monotonic() {
        if (armed && source === 'mono' && ++monos === failAt) {
          if (value === Infinity) { deadlineCrossed = true; return baselineMono + 1000; }
          faultSeen = true; return value;
        }
        return s.time.monotonic();
      },
    };
    const journal = { ...base, admission: async (input: Parameters<typeof base.admission>[0]) => {
      const result = await base.admission(input); if (input.kind === 'claimStart') armed = true; return result;
    } };
    const backend = new ControlledBackend(); const dispatch = backend.dispatchStartOnce.bind(backend);
    backend.dispatchStartOnce = (plan, operation) => {
      if (faultSeen || deadlineCrossed) violations++;
      return dispatch(plan, operation);
    };
    const manager = new Supervisor({ journal, installationId, clock, backendFactory: () => backend });
    await manager.actor(s.input).launch().catch(() => undefined);
    expect(violations).toBe(0);
  });
});

describe('review R1 captured append receipt', () => {
  it('same actor retries the exact committed event/ordinal after a lost append response', async () => {
    const s = await f.setup(); const base = port(s.journal); let lost = false;
    const journal = { ...base, appendSupervisor: async (input: Parameters<typeof base.appendSupervisor>[0]) => {
      const event = await base.appendSupervisor(input);
      if (input.event.kind === 'runtime.started' && !lost) { lost = true; throw new JournalError('unavailable'); }
      return event;
    } };
    const backend = new ControlledBackend();
    const manager = new Supervisor({ journal, installationId, clock: s.time, backendFactory: () => backend });
    const actor = manager.actor(s.input); await expect(actor.launch()).rejects.toMatchObject({ code: 'journal_unavailable' });
    backend.observation = { state: 'unknown', reason: 'unavailable' };
    await actor.tick(); await actor.cancel();
    const events = (await s.journal.readEvents(s.input.key, 0)).events;
    expect(events.filter(event => event.kind === 'runtime.started')).toHaveLength(1);
    expect(events.map(event => event.seq)).toEqual([1, 2, 3]);
    expect(reserved(await s.journal.admission({ kind: 'reservation', key: s.input.key })).launchSettlement?.disposition).toBe('completed');
    expect(backend.starts).toBe(1);
  });
});
