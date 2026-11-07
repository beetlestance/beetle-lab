import { describe, expect, it, vi } from 'vitest';
import { deferred, flush, harness } from './fixtures.js';

describe('one-shot child lifecycle', () => {
  it('pins fixed launch and shares one invocation across concurrent and late calls', async () => {
    const h = harness();
    const first = h.actor.run();
    expect(h.actor.run()).toBe(first);
    await flush(); h.child.start();
    expect(h.spawn).toHaveBeenCalledTimes(1);
    expect(h.spawn.mock.calls[0]).toEqual(['/owned/k6', ['run', '--no-usage-report', '--quiet', '--no-color',
      '--address', '', '--log-output', 'none', '--config', '/owned/empty.json', '--out', 'json=-', '/owned/output/suite.js'],
    { cwd: '/owned/output', shell: false, detached: true, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'], env: { K6_NO_USAGE_REPORT: 'true', LANG: 'C', LC_ALL: 'C' } }]);
    h.child.stdout.end(); h.absent(); h.child.end(); h.child.finish();
    const result = await first;
    expect(result.state).toBe('stopped');
    expect(Object.isFrozen(result)).toBe(true);
    expect(h.actor.run()).toBe(first);
    await h.actor.close(); expect(h.spawn).toHaveBeenCalledTimes(1);
  });

  it('fences cancelled preparation without a late spawn and close awaits issued validation', async () => {
    const gate = deferred(); const cancel = new AbortController();
    const h = harness({ signal: cancel.signal }, { validate: () => gate.promise });
    const run = h.actor.run(); cancel.abort();
    expect(await run).toMatchObject({ state: 'not_started', cause: 'cancelled', quiescent: false });
    let closed = false; const close = h.actor.close().then(() => { closed = true; });
    await flush(); expect(closed).toBe(false);
    gate.resolve(); await close;
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it('retains cancellation until delayed spawn becomes owned, with the original fixed grace', async () => {
    vi.useFakeTimers(); const cancel = new AbortController();
    const h = harness({ signal: cancel.signal }); const run = h.actor.run(); await flush();
    cancel.abort(); expect(h.signals).toEqual([]);
    await vi.advanceTimersByTimeAsync(50); h.child.start();
    expect(h.signals.filter(signal => signal !== 0)).toEqual(['SIGTERM']);
    await vi.advanceTimersByTimeAsync(2500); void h.actor.close();
    await vi.advanceTimersByTimeAsync(2499);
    expect(h.signals.filter(signal => signal !== 0)).toEqual(['SIGTERM']);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.signals.filter(signal => signal !== 0)).toEqual(['SIGTERM', 'SIGKILL']);
    h.absent(); h.child.end(null, 'SIGKILL'); h.child.finish();
    expect(await run).toMatchObject({ cause: 'cancelled', state: 'stopped' });
    await h.actor.close();
  });

  it('cleans a child which spawns after an unknown observation', async () => {
    vi.useFakeTimers(); const cancel = new AbortController();
    const h = harness({ signal: cancel.signal }); const run = h.actor.run(); await flush(); cancel.abort();
    await vi.advanceTimersByTimeAsync(100);
    expect(await run).toMatchObject({ cause: 'cancelled', state: 'unknown', quiescent: false });
    h.child.start(); expect(h.signals).toContain('SIGTERM');
    await vi.advanceTimersByTimeAsync(5000); expect(h.signals).toContain('SIGKILL');
    h.absent(); h.child.end(null, 'SIGKILL'); h.child.finish(); await h.actor.close();
  });

  it('handles ENOENT and never retries a failed spawn', async () => {
    const h = harness(); const run = h.actor.run(); await flush();
    h.child.pid = undefined; h.child.emit('error', new Error('secret ENOENT')); h.child.finish();
    const result = await run;
    expect(result).toMatchObject({ spawned: false, cause: 'spawn', state: 'unknown' });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(h.signals).toEqual([]); expect(h.actor.run()).toBe(run); await h.actor.close();
  });

  it('fences cancellation invoked synchronously inside spawn before its handle returns', async () => {
    vi.useFakeTimers(); const cancel = new AbortController(); const h = harness({ signal: cancel.signal });
    h.spawn.mockImplementation(() => { cancel.abort(); return h.child.port(); });
    const run = h.actor.run(); await flush(); expect(h.signals).toEqual([]);
    h.child.start(); expect(h.signals).toContain('SIGTERM');
    h.absent(); h.child.end(null, 'SIGTERM'); h.child.finish();
    expect(await run).toMatchObject({ cause: 'cancelled', state: 'stopped' }); await h.actor.close();
  });

  it('does not retry a thrown spawn or expose its error', async () => {
    const h = harness({}, { spawn: () => { throw new Error('SECRET'); } });
    const run = h.actor.run(); expect(await run).toMatchObject({ cause: 'spawn', state: 'not_started' });
    expect(JSON.stringify(await run)).not.toContain('SECRET'); expect(h.actor.run()).toBe(run); await h.actor.close();
  });

  it('handles an error after owned spawn without treating it as an exited child', async () => {
    vi.useFakeTimers(); const h = harness(); const run = h.actor.run(); await flush(); h.child.start();
    h.child.emit('error', new Error('SECRET'));
    await vi.advanceTimersByTimeAsync(5000); expect(h.signals).toContain('SIGKILL');
    h.absent(); h.child.end(null, 'SIGKILL'); h.child.finish();
    expect(await run).toMatchObject({ cause: 'child_error', state: 'stopped' }); await h.actor.close();
  });

  it('bounds a hung stdio close after parent and group exit', async () => {
    vi.useFakeTimers(); const h = harness(); const run = h.actor.run(); await flush(); h.child.start();
    h.absent(); h.child.end(137);
    await vi.advanceTimersByTimeAsync(200);
    expect(await run).toMatchObject({ cause: 'drain_timeout', state: 'unknown', stdioClosed: false });
    expect(h.signals.filter(signal => signal !== 0)).toEqual([]);
    h.child.finish(); await h.actor.close();
  });

  it('refuses missing or unsafe PID without signalling it', async () => {
    vi.useFakeTimers(); const h = harness(); const run = h.actor.run(); await flush();
    h.child.pid = 1; h.child.start(); await vi.advanceTimersByTimeAsync(100);
    expect(await run).toMatchObject({ state: 'unknown', cause: 'child_error' });
    expect(h.group).not.toHaveBeenCalled();
  });

  it('parent exit alone triggers descendant cleanup and unknown remains explicit', async () => {
    vi.useFakeTimers(); const h = harness(); const run = h.actor.run(); await flush(); h.child.start();
    h.child.end(0); h.child.finish();
    await vi.advanceTimersByTimeAsync(5100);
    expect(await run).toMatchObject({ state: 'unknown', cause: 'descendants', groupAbsent: false, quiescent: false });
    expect(h.signals.filter(signal => signal !== 0)).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('a sink cannot delay cancellation signals, and close waits for the original sink', async () => {
    vi.useFakeTimers(); const gate = deferred(); const cancel = new AbortController();
    let delivery: AbortSignal | undefined;
    const h = harness({ signal: cancel.signal, sink: async (_bytes, context) => {
      delivery = context.signal; await gate.promise;
    } });
    const run = h.actor.run(); await flush(); h.child.start(); h.child.stdout.write(Buffer.alloc(65_536));
    await vi.advanceTimersByTimeAsync(0); cancel.abort(); expect(delivery?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(5000); expect(h.signals).toContain('SIGKILL');
    h.absent(); h.child.end(null, 'SIGKILL'); h.child.finish();
    await vi.advanceTimersByTimeAsync(100);
    const result = await run;
    expect(result).toMatchObject({ state: 'stopped', collection: 'partial', quiescent: false });
    let closed = false; const close = h.actor.close().then(() => { closed = true; });
    await flush(); expect(closed).toBe(false);
    gate.resolve(); await close; expect(result.quiescent).toBe(false);
  });
});
