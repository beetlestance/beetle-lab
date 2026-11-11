import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { decodeLiveMetricSnapshot } from '@beetle/contracts/api';
import { DurationHistogram, projectMetricSeries } from '@beetle/contracts/metrics';
import { deferred, fixture, hash, window } from './fixtures.js';
beforeEach(() => vi.useFakeTimers());
afterEach(() => {vi.clearAllTimers(); vi.useRealTimers();});
it('projects sparse windows, leaves gaps unsynthesized and never invokes sink IO inside acceptance', async () => {
  const f = fixture(); expect(f.publisher.accept(window(1))).toBe(true); expect(f.write).not.toHaveBeenCalled();
  await f.advance(); expect(f.frames[0]).toMatchObject({sourceSequence: 1, publishedSequence: 1, coalescedWindows: 0, upstreamCoverage: 'unknown'});
  expect(f.frames[0]!.series).toEqual([projectMetricSeries(window(1).series[0]!, 0)]);
  expect(f.publisher.accept({...window(4), series: []})).toBe(true); await f.advance(2000);
  expect(f.frames[1]).toMatchObject({sourceSequence: 2, startTimeMs: 4000, series: []});
  expect(f.publisher.state().chargedBytes).toBeGreaterThan(0); await f.publisher.close();
});
it('keeps one immutable original and one replaceable latest slot with exact coalescing', async () => {
  const held = deferred(); const frames: ReturnType<typeof decodeLiveMetricSnapshot>[] = [];
  const write = vi.fn((bytes: Uint8Array) => {frames.push(decodeLiveMetricSnapshot(bytes, hash)); return frames.length === 1 ? held.promise : Promise.resolve();});
  const f = fixture({sink: {write, close: async () => {}}}); f.publisher.accept(window(1)); await f.advance();
  f.publisher.accept(window(2)); f.publisher.accept(window(3)); await f.advance(5000);
  expect(write).toHaveBeenCalledTimes(1); expect(frames[0]).toMatchObject({sourceSequence: 1, coalescedWindows: 0});
  expect(f.publisher.state()).toMatchObject({pending: true, writing: true, coalescedWindows: 1});
  held.resolve(); await f.advance();
  expect(write).toHaveBeenCalledTimes(2); expect(frames[1]).toMatchObject({sourceSequence: 3, publishedSequence: 2, coalescedWindows: 1});
  await f.publisher.close();
});
it('coalesces before first publication and enforces the complete two-second cadence', async () => {
  const f = fixture(); f.publisher.accept(window(1)); f.publisher.accept(window(2)); await f.advance();
  expect(f.frames[0]).toMatchObject({sourceSequence: 2, publishedSequence: 1, coalescedWindows: 1});
  f.publisher.accept(window(3)); await f.advance(1999); expect(f.write).toHaveBeenCalledTimes(1);
  await f.advance(1); expect(f.write).toHaveBeenCalledTimes(2); await f.publisher.close();
});
it('admits a window between write success and original cleanup without double-counting publication', async () => {
  const f = fixture(); f.publisher.accept(window(1)); vi.advanceTimersByTime(0);
  let observed = false;
  for (let step = 0; step < 20; step++) {
    await Promise.resolve();
    const state = f.publisher.state();
    if (state.publishedSequence === 1 && state.writing) {
      observed = true; expect(f.publisher.accept(window(2))).toBe(true); break;
    }
  }
  expect(observed).toBe(true); await f.advance(2000);
  expect(f.frames[1]).toMatchObject({sourceSequence: 2, publishedSequence: 2, coalescedWindows: 0});
  expect(f.publisher.state().reason).toBeNull(); await f.publisher.close();
});
it('detaches admitted input values, subset and scope before caller mutation', async () => {
  const f = fixture(); const source = window(1); f.publisher.accept(source);
  Object.assign(source.series[0]!.total, {sum: 999}); Object.assign(f.options.scope, {generation: 7});
  Object.assign(f.options.subset.selected[0]!.tags, {request: 'other'});
  await f.advance(); expect(f.frames[0]!.series[0]!.total).toEqual({kind: 'counter', sum: 1});
  expect(f.frames[0]!.scope.generation).toBe(1); expect(f.frames[0]!.subset.selected[0]!.tags.request).toBe('r0'); await f.publisher.close();
});
it('uses shared rate/gauge/histogram projections without retaining histogram arrays', async () => {
  const histogram = new DurationHistogram(); histogram.record(2); histogram.record(4);
  const series = [window(1).series[0]!, {metric: 'http_req_failed', kind: 'rate' as const, scope: 'execute' as const, tags: {}, total: {kind: 'rate' as const, numerator: 0, sampleCount: 0}},
    {metric: 'vus', kind: 'gauge' as const, scope: 'engine' as const, tags: {}, total: {kind: 'gauge' as const, latest: 2, min: 1, max: 2, sourceTimeMs: 1500}},
    {metric: 'http_req_duration', kind: 'trend' as const, scope: 'execute' as const, tags: {}, total: {kind: 'trend' as const, count: 2, sum: 6, min: 2, max: 4, mean: 3, distribution: histogram.snapshot()}}];
  const selected = series.map((row, ordinal) => ({ordinal, metric: row.metric, kind: row.kind, scope: row.scope as 'execute' | 'engine', tags: row.tags}));
  const f = fixture({subset: {selected, excludedSeries: 0}}); f.publisher.accept({...window(1), series}); await f.advance();
  expect(f.frames[0]!.series).toEqual(series.map(projectMetricSeries));
  expect(f.frames[0]!.series[1]!.total).toMatchObject({ratio: null}); expect(JSON.stringify(f.frames)).not.toContain('buckets'); await f.publisher.close();
});
it.each(['overlap', 'cardinality', 'duplicate'] as const)('fences invalid input without throwing into metric callbacks: %s', async kind => {
  const f = fixture(); f.publisher.accept(window(1)); await f.advance();
  const next = kind === 'overlap' ? window(1) : kind === 'cardinality' ? {...window(2), series: Array.from({length: 4097}, () => window(2).series[0]!)}
    : {...window(2), series: [window(2).series[0]!, window(2).series[0]!]};
  expect(f.publisher.accept(next)).toBe(false); expect(f.publisher.state()).toMatchObject({status: 'failed', reason: 'invalid_input'});
  expect(f.publisher.accept(window(3))).toBe(false); await f.publisher.close();
});
