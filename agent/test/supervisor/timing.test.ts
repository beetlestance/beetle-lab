import { describe, expect, it } from 'vitest';
import { controlled, deferred, now, port, reserved, supervisorFixture } from './fixtures.js';
const f = supervisorFixture();

describe('supervision timing integrity across delayed callbacks', () => {
  it('held pre-launch supervision reply cannot extend the execution budget', async () => {
    const s = await f.setup(); const entered = deferred<void>(); const resume = deferred<void>(); let first = true;
    const base = port(s.journal);
    const c = controlled({ ...base, supervision: async input => {
      const state = await base.supervision(input);
      if (first) { first = false; entered.resolve(); await resume.promise; }
      return state;
    } }, s.time);
    const launch = c.manager.actor(s.input).launch(); await entered.promise;
    // Wall stops, but the in-flight request consumes the same absolute budget.
    s.time.monoOnly(s.time.monotonic() + 1000); resume.resolve();
    expect(await launch).toMatchObject({ cancellation: 'timeout' });
    expect(c.backend.creates).toBe(0); expect(c.backend.starts).toBe(0);
  });
  it('held durable cancel reply cannot grant a fresh five-second grace on receipt', async () => {
    const s = await f.setup(); const entered = deferred<void>(); const resume = deferred<void>(); let hold = true;
    const base = port(s.journal);
    const c = controlled({ ...base, supervision: async input => {
      const state = await base.supervision(input);
      if (input.cancel && hold) { hold = false; entered.resolve(); await resume.promise; }
      return state;
    } }, s.time);
    const actor = c.manager.actor(s.input); await actor.launch(); const cancel = actor.cancel(); await entered.promise;
    expect((await s.journal.get(s.input.key)).cancelRequested).toBe(true);
    s.time.monoOnly(s.time.monotonic() + 5000); resume.resolve();
    await cancel; expect(c.backend.kills).toBe(1); expect(c.backend.stops).toHaveLength(0);
  });
  it('wall deadline advancing during a delayed start grant retires the grant without dispatch', async () => {
    const s = await f.setup(); const entered = deferred<void>(); const resume = deferred<void>();
    const c = controlled(port(s.journal, async input => {
      const value = await s.journal.admission(input);
      if (input.kind === 'claimStart') { entered.resolve(); await resume.promise; }
      return value;
    }), s.time);
    const actor = c.manager.actor(s.input); const launch = actor.launch(); await entered.promise;
    s.time.wallOnly(now + 1000); resume.resolve(); await launch;
    expect(c.backend.starts).toBe(0);
    expect(reserved(await s.journal.admission({ kind: 'reservation', key: s.input.key })).launchSettlement?.disposition).toBe('retired');
    expect((await actor.tick()).cancellation).toBe('timeout');
  });
  it('wall rollback during a delayed start grant never sends start', async () => {
    const s = await f.setup(); const entered = deferred<void>(); const resume = deferred<void>();
    const c = controlled(port(s.journal, async input => {
      const value = await s.journal.admission(input);
      if (input.kind === 'claimStart') { entered.resolve(); await resume.promise; }
      return value;
    }), s.time);
    const launch = c.manager.actor(s.input).launch(); await entered.promise;
    s.time.wallOnly(now - 1); resume.resolve();
    expect(await launch).toMatchObject({ cancellation: 'clock_integrity', launch: 'unknown' });
    expect(c.backend.starts).toBe(0);
  });
  it('inherited MAX_SAFE clock never enters normal grace/date arithmetic', async () => {
    const s = await f.setup();
    // The private journal retains legacy admission clocks above Date range.
    // Use a faithful port to replay that already-qualified journal state.
    const base = port(s.journal);
    const c = controlled({ ...base, supervision: async input => {
      await base.supervision(input);
      return { clockHighWater: Number.MAX_SAFE_INTEGER, clockFenced: true,
        cancelRequestedAt: Number.MAX_SAFE_INTEGER, cancelRequested: true, cancelReason: 'cancelled', immediateStop: false };
    } }, s.time);
    const result = await c.manager.actor(s.input).launch();
    expect(result.cancellation).toBe('clock_integrity'); expect(c.backend.creates).toBe(0);
    expect(c.backend.stops).toHaveLength(0);
  });
});
