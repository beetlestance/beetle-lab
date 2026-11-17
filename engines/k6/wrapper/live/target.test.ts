import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TargetRuntimeSample } from '@beetle/contracts/target-runtime';
import { fixture, window } from './fixtures.js';
import { liveTargetReadings } from './target.js';
beforeEach(() => vi.useFakeTimers());
afterEach(() => {vi.clearAllTimers(); vi.useRealTimers();});
const at = (ms: number) => new Date(ms).toISOString();
function sample(ms: number, phase: TargetRuntimeSample['phase'] = 'during', rss: number | null = 2048): TargetRuntimeSample {
  const ready = rss !== null;
  return {observedAt: at(ms), phase, status: ready ? 'ready' : 'unavailable', reason: ready ? null : 'timeout',
    values: {rss, cpuPercent: ready ? 12.5 : null, 'eventLoopDelay.p99': ready ? 3 : null, heapAlloc: null} as unknown as TargetRuntimeSample['values']};
}
const source = (samples: TargetRuntimeSample[], intervalMs = 1000) => ({intervalMs, recent: (limit: number) => samples.slice(-limit)});

it('carries the newest bounded before/during samples with fixed keys, explicit nulls and actual zero', () => {
  const samples = [sample(90000, 'before', 0), ...Array.from({length: 9}, (_, i) => sample(91000 + i * 1000))];
  const block = liveTargetReadings(source(samples), 100000);
  expect(block).toMatchObject({scope: 'target-reported', intervalMs: 1000, omittedSamples: 0});
  expect(block.samples).toHaveLength(8); expect(block.samples[0]!.observedAtMs).toBe(92000);
  expect(block.samples[7]!.values).toEqual({rss: 2048, heapAlloc: null, heapInuse: null, usedHeapSize: null, totalHeapSize: null,
    cpuPercent: 12.5, systemCpuPercent: null, 'eventLoopDelay.mean': null, 'eventLoopDelay.p99': 3, 'eventLoopDelay.max': null,
    activeHandles: null, goroutines: null});
  expect(liveTargetReadings(source([sample(99000, 'before', 0)]), 100000).samples[0]!.values.rss).toBe(0);
});
it('omits future, stale, after-phase and out-of-order samples instead of repairing them', () => {
  const samples = [sample(80000), sample(97000), sample(96000), sample(98000, 'after'), sample(101000)];
  const block = liveTargetReadings(source(samples), 100000);
  expect(block.samples.map(s => s.observedAtMs)).toEqual([97000]); expect(block.omittedSamples).toBe(4);
  const missed = liveTargetReadings(source([sample(99000, 'during', null)]), 100000).samples[0]!;
  expect(missed.status).toBe('unavailable'); expect(Object.values(missed.values).every(v => v === null)).toBe(true);
});
it('publishes the target block in the frame read at publication time, after the metric window', async () => {
  const samples: TargetRuntimeSample[] = [sample(99000, 'before')];
  const f = fixture({target: source(samples)});
  f.publisher.accept(window(1)); samples.push(sample(100000)); await f.advance();
  expect(f.frames[0]!.target).toMatchObject({intervalMs: 1000, omittedSamples: 0});
  expect(f.frames[0]!.target!.samples.map(s => s.phase)).toEqual(['before', 'during']);
  expect(f.frames[0]!.series).toHaveLength(1); await f.publisher.close();
});
it('drops only the advisory target block when it cannot be read, keeping the metric frame', async () => {
  const f = fixture({target: {intervalMs: 1000, recent: () => {throw new Error('sampler');}}});
  f.publisher.accept(window(1)); await f.advance();
  expect(f.frames[0]!.target).toBeUndefined(); expect(f.frames[0]!.series).toHaveLength(1);
  expect(f.publisher.state()).toMatchObject({targetOmittedFrames: 1, reason: null}); await f.publisher.close();
});
it('frames without target sampling stay byte-identical in shape (no target key)', async () => {
  const f = fixture(); f.publisher.accept(window(1)); await f.advance();
  expect('target' in f.frames[0]!).toBe(false); await f.publisher.close();
});
it('refuses an unapproved interval at construction', () => {
  expect(() => fixture({target: {intervalMs: 999, recent: () => []}})).toThrow('Live metric publisher rejected');
});
