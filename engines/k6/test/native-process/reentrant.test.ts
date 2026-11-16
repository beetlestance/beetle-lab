import { expect, it, vi } from 'vitest';
import { deferred, flush, harness } from './fixtures.js';

it('permanently retires a group once TERM confirms absence, even if the numeric identity is reused', async () => {
  vi.useFakeTimers(); const cancel = new AbortController(); const calls: (NodeJS.Signals | 0)[] = [];
  let retired = false; let cleanup = false;
  const h = harness({ signal: cancel.signal }, { group: (_pid, signal) => {
    calls.push(signal);
    if (signal === 'SIGTERM') { retired = true; return 'absent'; }
    return cleanup ? 'absent' : 'present';
  } });
  const run = h.actor.run(); await flush(); h.child.start(); cancel.abort();
  await vi.advanceTimersByTimeAsync(5000);
  const recorded = [...calls];
  cleanup = true; h.child.end(null, 'SIGTERM'); h.child.finish(); await run; await h.actor.close();
  expect(retired).toBe(true);
  expect(recorded).toEqual(['SIGTERM']);
  expect(calls).toEqual(['SIGTERM']);
});

it('does not issue profile validation after synchronous watch deadline denial', async () => {
  const gate = deferred(); let samples = 0; const validate = vi.fn(() => gate.promise);
  const h = harness({ attempt: { mode: 'managed', timeoutMs: 1000, deadlineMs: 2000 },
    clock: { wall: () => ++samples >= 4 ? 2000 : 1000, monotonic: () => 0 } }, { validate });
  const result = await h.actor.run();
  try {
    expect(result).toMatchObject({ state: 'not_started', cause: 'deadline', quiescent: true });
    expect(validate).not.toHaveBeenCalled(); expect(h.spawn).not.toHaveBeenCalled();
  } finally { gate.resolve(); await h.actor.close(); }
});

it('rechecks cancellation after the exact final wall clock callback returns valid time', async () => {
  const cancel = new AbortController(); let samples = 0;
  const h = harness({ signal: cancel.signal, attempt: { mode: 'managed', timeoutMs: 1000, deadlineMs: 2000 },
    clock: { wall: () => { if (++samples === 6) cancel.abort(); return 1000; }, monotonic: () => 0 } });
  const run = h.actor.run(); await flush(); const result = await run;
  // Complete any baseline-issued synthetic handle before assertions; never signal actual OS PIDs.
  if (h.spawn.mock.calls.length) { h.child.start(); h.absent(); h.child.end(); h.child.finish(); }
  await h.actor.close();
  expect(result).toMatchObject({ cause: 'cancelled', state: 'not_started', quiescent: true });
  expect(h.spawn).not.toHaveBeenCalled();
});

it('publishes an issued spawn before a synchronous factory abort/close and waits for its late child', async () => {
  vi.useFakeTimers(); const cancel = new AbortController(); const h = harness({ signal: cancel.signal });
  let close: Promise<void> | undefined; let closed = false;
  h.spawn.mockImplementation(() => {
    cancel.abort(); close = h.actor.close().then(() => { closed = true; }); return h.child.port();
  });
  const run = h.actor.run(); await flush(); await vi.advanceTimersByTimeAsync(100);
  const result = await run;
  expect(result).toMatchObject({ cause: 'cancelled', state: 'unknown', quiescent: false });
  expect(closed).toBe(false); expect(h.signals).toEqual([]);
  h.child.start(); expect(h.signals.filter(signal => signal !== 0)).toEqual(['SIGTERM']);
  await vi.advanceTimersByTimeAsync(5000);
  expect(h.signals.filter(signal => signal !== 0)).toEqual(['SIGTERM', 'SIGKILL']);
  expect(closed).toBe(false);
  h.absent(); h.child.end(null, 'SIGKILL'); h.child.finish(); await close;
  expect(closed).toBe(true); expect(h.spawn).toHaveBeenCalledTimes(1);
});

it('publishes original profile work before validation can synchronously reenter close', async () => {
  const gate = deferred(); let close: Promise<void> | undefined; let closed = false;
  const h = harness({}, { validate: () => {
    close = h.actor.close().then(() => { closed = true; }); return gate.promise;
  } });
  const result = await h.actor.run(); await flush();
  try {
    expect(result).toMatchObject({ cause: 'closed', state: 'not_started', quiescent: false });
    expect(closed).toBe(false); expect(h.spawn).not.toHaveBeenCalled();
  } finally { gate.resolve(); await close; await h.actor.close(); }
});

it('rechecks cancellation after the final monotonic callback returns valid time', async () => {
  const cancel = new AbortController(); let samples = 0;
  const h = harness({ signal: cancel.signal, attempt: { mode: 'managed', timeoutMs: 1000, deadlineMs: 2000 },
    clock: { wall: () => 1000, monotonic: () => { if (++samples === 6) cancel.abort(); return 0; } } });
  expect(await h.actor.run()).toMatchObject({ cause: 'cancelled', state: 'not_started', quiescent: true });
  expect(h.spawn).not.toHaveBeenCalled(); await h.actor.close();
});

it('does not issue validation after a watch clock callback cancels but returns valid time', async () => {
  const cancel = new AbortController(); let samples = 0; const validate = vi.fn(async () => {});
  const h = harness({ signal: cancel.signal, attempt: { mode: 'managed', timeoutMs: 1000, deadlineMs: 2000 },
    clock: { wall: () => { if (++samples === 4) cancel.abort(); return 1000; }, monotonic: () => 0 } }, { validate });
  expect(await h.actor.run()).toMatchObject({ cause: 'cancelled', state: 'not_started', quiescent: true });
  expect(validate).not.toHaveBeenCalled(); expect(h.spawn).not.toHaveBeenCalled(); await h.actor.close();
});

it('suppresses validation and the obsolete timer if scheduling synchronously reenters cancellation', async () => {
  vi.useFakeTimers(); const cancel = new AbortController(); const validate = vi.fn(async () => {});
  const schedule = globalThis.setTimeout;
  const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementationOnce((callback, delay, ...args) => {
    cancel.abort(); return schedule(callback, delay, ...args);
  });
  const h = harness({ signal: cancel.signal }, { validate });
  try {
    expect(await h.actor.run()).toMatchObject({ cause: 'cancelled', state: 'not_started', quiescent: true });
    expect(validate).not.toHaveBeenCalled(); expect(h.spawn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0); await h.actor.close();
  } finally { timer.mockRestore(); }
});

it('a reentrant sink abort observes the same close promise and original sink operation', async () => {
  vi.useFakeTimers(); const gate = deferred(); let nested: Promise<void> | undefined;
  const h = harness({ sink: async (_bytes, delivery) => {
    delivery.signal.addEventListener('abort', () => { nested = h.actor.close(); }); await gate.promise;
  } });
  const run = h.actor.run(); await flush(); h.child.start(); h.child.stdout.write(Buffer.alloc(65_536));
  await vi.advanceTimersByTimeAsync(0);
  const close = h.actor.close(); expect(nested).toBe(close);
  let closed = false; void close.then(() => { closed = true; });
  h.absent(); h.child.end(null, 'SIGTERM'); h.child.finish(); await flush();
  expect(closed).toBe(false);
  gate.resolve(); await close; expect((await run).cause).toBe('closed');
});

it('retires absence from a probe even when another callback returns a stale present result', async () => {
  vi.useFakeTimers(); const cancel = new AbortController(); const calls: (NodeJS.Signals | 0)[] = [];
  const h = harness({ signal: cancel.signal }, { group: (_pid, signal) => {
    calls.push(signal);
    if (signal === 0) { cancel.abort(); return 'present'; }
    return 'absent';
  } });
  const run = h.actor.run(); await flush(); h.child.start(); h.child.end(); h.child.finish();
  const result = await run; await vi.advanceTimersByTimeAsync(5100); await h.actor.close();
  expect(result).toMatchObject({ cause: 'cancelled', state: 'stopped', groupAbsent: true });
  expect(calls).toEqual([0, 'SIGTERM']);
});
