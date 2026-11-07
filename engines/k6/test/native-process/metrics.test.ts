import { expect, it, vi } from 'vitest';
import { deferred, flush, harness } from './fixtures.js';

it('serializes awaited bounded chunks and never queues sink calls', async () => {
  vi.useFakeTimers(); const gate = deferred(); const sizes: number[] = [];
  const h = harness({ sink: async bytes => { sizes.push(bytes.length); await gate.promise; } });
  const run = h.actor.run(); await flush(); h.child.start();
  h.child.stdout.write(Buffer.alloc(131_072)); await vi.advanceTimersByTimeAsync(0);
  expect(sizes).toEqual([65_536]);
  gate.resolve(); await vi.advanceTimersByTimeAsync(0);
  expect(sizes).toEqual([65_536, 65_536]);
  h.child.stdout.end(); await vi.advanceTimersByTimeAsync(0);
  h.absent(); h.child.end(99); h.child.finish();
  const result = await run;
  expect(result).toMatchObject({ metricBytes: 131_072, collection: 'complete', exitCode: 99, cause: null });
  expect(result).not.toHaveProperty('passed'); expect(result).not.toHaveProperty('oom'); await h.actor.close();
});
it('rejects excessive transient buffering without delivery', async () => {
  vi.useFakeTimers(); const sink = vi.fn(async () => {}); const h = harness({ sink });
  const run = h.actor.run(); await flush(); h.child.start();
  h.child.stdout.write(Buffer.alloc(8_388_608)); await vi.advanceTimersByTimeAsync(0);
  expect(sink).not.toHaveBeenCalled(); expect(h.signals).toContain('SIGTERM');
  h.absent(); h.child.end(); h.child.finish(); expect(await run).toMatchObject({ cause: 'stream' }); await h.actor.close();
});
it('stops at the total metric transport limit, separate from persisted output quota', async () => {
  vi.useFakeTimers(); const sink = vi.fn(async () => {}); const h = harness({ maxMetricStreamBytes: 65_536, sink });
  const run = h.actor.run(); await flush(); h.child.start();
  h.child.stdout.write(Buffer.alloc(65_536)); await vi.advanceTimersByTimeAsync(0);
  h.child.stdout.write(Buffer.alloc(65_536)); await vi.advanceTimersByTimeAsync(0);
  expect(sink).toHaveBeenCalledTimes(1); expect(h.signals).toContain('SIGTERM');
  h.absent(); h.child.end(); h.child.finish();
  expect(await run).toMatchObject({ cause: 'metric_limit', metricBytes: 65_536, collection: 'partial' }); await h.actor.close();
});
it('counts diagnostic bytes without retaining or exposing raw sentinels', async () => {
  const h = harness({ maxDiagnosticBytes: 3 }); const run = h.actor.run(); await flush(); h.child.start();
  h.child.stderr.write('SECRET/URL?token=canary');
  h.absent(); h.child.end(); h.child.finish(); const result = await run;
  expect(result).toMatchObject({ cause: 'diagnostic_limit', diagnosticBytes: 23 });
  expect(JSON.stringify(result)).not.toMatch(/SECRET|URL|token|canary/); await h.actor.close();
});
it.each(['sync', 'async'] as const)('sanitizes %s sink failure and stops the child', async mode => {
  vi.useFakeTimers(); const h = harness({ sink: () => {
    if (mode === 'sync') throw new Error('SECRET');
    return Promise.reject(new Error('SECRET'));
  } });
  const run = h.actor.run(); await flush(); h.child.start();
  h.child.stdout.write(Buffer.alloc(65_536)); await vi.advanceTimersByTimeAsync(0);
  expect(h.signals).toContain('SIGTERM'); h.absent(); h.child.end(); h.child.finish();
  const result = await run; expect(result).toMatchObject({ cause: 'sink', collection: 'partial' });
  expect(JSON.stringify(result)).not.toContain('SECRET'); await h.actor.close();
});
it('does not accept late delivery as complete evidence after bounded drain', async () => {
  vi.useFakeTimers(); const gate = deferred(); const h = harness({ sink: () => gate.promise });
  const run = h.actor.run(); await flush(); h.child.start();
  h.child.stdout.write(Buffer.alloc(65_536)); await vi.advanceTimersByTimeAsync(0);
  h.absent(); h.child.end(0); h.child.finish();
  await vi.advanceTimersByTimeAsync(200);
  const result = await run;
  expect(result).toMatchObject({ cause: 'drain_timeout', collection: 'partial', quiescent: false });
  gate.resolve(); await h.actor.close();
  expect(result.collection).toBe('partial');
});
it('a stream error stops signals independently of its error payload', async () => {
  const h = harness(); const run = h.actor.run(); await flush(); h.child.start();
  h.child.stdout.emit('error', new Error('SECRET'));
  expect(h.signals).toContain('SIGTERM'); h.absent(); h.child.end(); h.child.finish();
  const result = await run; expect(result.cause).toBe('stream'); expect(JSON.stringify(result)).not.toContain('SECRET');
  await h.actor.close();
});
