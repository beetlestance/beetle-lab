import { expect, it, vi } from 'vitest';
import { ProcessBoundaryError } from '../../wrapper/process/index.js';
import { deferred, flush, harness } from './fixtures.js';

function clocks() {
  const time = { wall: 1000, mono: 100 };
  return { time, clock: { wall: () => time.wall, monotonic: () => time.mono },
    attempt: { mode: 'managed' as const, timeoutMs: 1000, deadlineMs: 2000 } };
}
it('does not reset the admitted deadline after preparation', async () => {
  const gate = deferred(); const c = clocks();
  const h = harness(c, { validate: () => gate.promise }); const run = h.actor.run();
  c.time.wall = 2000; c.time.mono = 1100; gate.resolve();
  expect(await run).toMatchObject({ state: 'not_started', cause: 'deadline' });
  expect(h.spawn).not.toHaveBeenCalled(); await h.actor.close();
});
it('checks the final clock sample before granting launch', async () => {
  const c = clocks(); let final = false; let reads = 0;
  const h = harness({ ...c, clock: { monotonic: c.clock.monotonic,
    wall: () => { if (final) reads++; return reads >= 2 ? 2000 : 1000; } } },
  { validate: async () => { final = true; } });
  const run = h.actor.run();
  expect(await run).toMatchObject({ cause: 'deadline', spawned: false });
  expect(h.spawn).not.toHaveBeenCalled(); await h.actor.close();
});
it('retains the local monotonic ceiling when wall time barely advances', async () => {
  vi.useFakeTimers(); const c = clocks(); const h = harness(c); const run = h.actor.run(); await flush();
  h.child.start(); c.time.wall = 1001; c.time.mono = 1100;
  await vi.advanceTimersByTimeAsync(50);
  expect(h.signals).toContain('SIGTERM');
  h.absent(); h.child.end(null, 'SIGTERM'); h.child.finish();
  expect(await run).toMatchObject({ cause: 'deadline', state: 'stopped' }); await h.actor.close();
});
it.each(['wall', 'mono'] as const)('fails closed on %s rollback after launch', async field => {
  vi.useFakeTimers(); const c = clocks(); const h = harness(c); const run = h.actor.run(); await flush();
  h.child.start(); c.time[field]--;
  await vi.advanceTimersByTimeAsync(50);
  expect(h.signals).toContain('SIGTERM');
  h.absent(); h.child.end(null, 'SIGTERM'); h.child.finish();
  expect(await run).toMatchObject({ cause: 'clock' }); await h.actor.close();
});
it('rejects invalid and throwing clocks without leaking callback errors', () => {
  expect(() => harness({ clock: { wall: () => NaN, monotonic: () => 0 } })).toThrowError(ProcessBoundaryError);
  expect(() => harness({ clock: { wall: () => { throw new Error('SECRET'); }, monotonic: () => 0 } }))
    .toThrowError('clock');
});
it('samples the deadline at terminal handoff independently from the exit callback', async () => {
  const c = clocks(); let gone = false;
  const h = harness(c, { group: () => {
    if (gone) c.time.wall = 2000;
    return gone ? 'absent' : 'present';
  } });
  const run = h.actor.run(); await flush(); h.child.start();
  gone = true; h.child.stdout.end(); h.child.end(); h.child.finish();
  expect(await run).toMatchObject({ state: 'stopped', cause: 'deadline', collection: 'partial' });
  await h.actor.close();
});
it('cancellation already present and close before run cannot launch', async () => {
  const signal = new AbortController(); signal.abort();
  const h = harness({ signal: signal.signal });
  expect(await h.actor.run()).toMatchObject({ cause: 'cancelled', state: 'not_started' });
  await h.actor.close(); expect(h.spawn).not.toHaveBeenCalled();
  const closed = harness(); const close = closed.actor.close(); expect(closed.actor.close()).toBe(close);
  await close; expect(await closed.actor.run()).toMatchObject({ cause: 'closed', state: 'not_started' });
  expect(closed.spawn).not.toHaveBeenCalled();
});
