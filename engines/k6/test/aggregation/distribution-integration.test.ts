import { expect, it } from 'vitest';
import { encodeJson } from '@beetle/contracts';
import { DurationHistogram, MetricAccumulator, createK6MetricProfile, distributionPercentile } from '../../aggregation/index.js';
import type { MetricSnapshot, NumericTotal } from '../../aggregation/index.js';
import { compiled } from '../suite/fixtures.js';
import { configFor } from '../runtime/fixtures.js';
import { marker, point, setup, signal } from './accumulator/fixtures.js';

it('snapshots independent windows while late trend samples only enter final totals', async () => {
  const { accumulator, feed, windows } = setup();
  await feed(marker()); await feed(point('http_req_duration', 1, 1000));
  await feed(point('http_req_duration', 2, 2000)); await feed(point('http_req_duration', 3, 4000));
  const first = windows[0]!.series[0]!.total;
  await feed(point('http_req_duration', 100, 1000));
  const final = await accumulator.finish(signal());
  expect(final.windowCoverage.latePoints).toBe(1);
  expect(first).toMatchObject({ count: 1, distribution: { count: 1, min: 1, max: 1 } });
  const total = final.totals[0]!.total;
  expect(total).toMatchObject({ count: 4, sum: 106, distribution: { count: 4, min: 1, max: 100 } });
  if (total.kind !== 'trend') throw new Error('expected trend');
  expect(distributionPercentile(total.distribution, 95)!.upper).toBe(100);
  expect(Object.isFrozen(first)).toBe(true);
  expect(total.distribution).not.toBe((first as Extract<NumericTotal, { kind: 'trend' }>).distribution);
});
it('refuses count and sum overflow before mutating existing histogram state', async () => {
  const histogram = new DurationHistogram(); histogram.record(1);
  const state = histogram as unknown as { count: number };
  state.count = Number.MAX_SAFE_INTEGER;
  const before = histogram.snapshot();
  expect(() => histogram.record(0)).toThrowError(expect.objectContaining({ code: 'overflow' }));
  expect(histogram.snapshot()).toEqual(before);
  const { accumulator } = setup(); await accumulator.point(marker(), signal());
  await accumulator.point(point('http_req_duration', Number.MAX_VALUE), signal());
  const totals = (accumulator as unknown as { totals: Map<string, { total: { distribution: DurationHistogram } }> }).totals;
  const existing = [...totals.values()][0]!.total.distribution;
  const original = existing.snapshot();
  await expect(accumulator.point(point('http_req_duration', Number.MAX_VALUE), signal())).rejects.toMatchObject({ code: 'overflow' });
  expect(existing.snapshot()).toEqual(original);
});
function maxProfile() {
  const config = configFor(); const request = config.requests[0]!;
  config.requests = Array.from({ length: 64 }, (_, i) => ({ ...request, id: `request${i}`, name: `request${i}`, assertions: [] }));
  config.selections[0]!.entries[0]!.requestId = 'request0';
  return createK6MetricProfile(compiled(config));
}
it('bounds max-compiler series, fixed counters, detached output and final serialization', async () => {
  const profile = maxProfile();
  const trends = profile.allowedSeries.filter(item => item.kind === 'trend' && item.scope === 'execute');
  expect(trends).toHaveLength(449);
  let windows = 0; let maxSnapshotBytes = 0;
  const histogramArrays = new Set<Float64Array>();
  const accumulator = new MetricAccumulator({ profile, window: async window => {
    windows++; maxSnapshotBytes = Math.max(maxSnapshotBytes, Buffer.byteLength(JSON.stringify(window)));
    for (const series of window.series) if (series.total.kind === 'trend') {
      expect(series.total.distribution.buckets).toHaveLength(64);
      expect(Object.isFrozen(series.total.distribution.buckets)).toBe(true);
    }
  } });
  const beforeHeap = process.memoryUsage().heapUsed;
  const testSignal = signal();
  for (const entry of profile.allowedSeries.filter(item => item.scope === 'prepare')) {
    await accumulator.point({ ...entry, value: 1, timeMs: 0 }, testSignal);
  }
  type InternalSeries = { total: { kind: string; distribution?: { counters: Float64Array } } };
  const state = accumulator as unknown as { totals: Map<string, InternalSeries>;
    windows: { buckets: Map<number, Map<string, InternalSeries>> } };
  expect(state.totals.size).toBe(0); expect(state.windows.buckets.size).toBe(0);
  await accumulator.point(marker(), testSignal);
  for (const timeMs of [1000, 2000, 3000]) {
    for (const entry of profile.allowedSeries.filter(item => item.scope !== 'prepare' && item.scope !== 'control')) {
      const values = entry.kind === 'trend' ? Array.from({ length: 64 }, (_, i) => 1.01 * 2 ** (i / 16)) : [1];
      for (const value of values) await accumulator.point({ ...entry, value, timeMs }, testSignal);
    }
  }
  for (const map of [state.totals, ...state.windows.buckets.values()]) {
    for (const series of map.values()) if (series.total.distribution) histogramArrays.add(series.total.distribution.counters);
  }
  expect(state.windows.buckets.size).toBe(3);
  expect(histogramArrays.size).toBe(449 * 4);
  expect([...histogramArrays].reduce((sum, array) => sum + array.byteLength, 0)).toBe(919_552);
  // Finalization overlaps retained state, detached arrays, JSON UTF16 and encoded bytes.
  const final: MetricSnapshot = await accumulator.finish(testSignal);
  const value = { version: 2, scope: null, metrics: final, diagnostics: {}, windowsRetained: false, quantiles: final.quantiles };
  const json = encodeJson(value, 1_048_575); const bytes = Buffer.byteLength(json) + 1;
  expect(bytes).toBeLessThan(1_048_576); expect(windows).toBe(3); expect(state.windows.buckets.size).toBe(0);
  expect(() => encodeJson(value, bytes - 2)).toThrow();
  const counterBytesWithDetached = 449 * 64 * 8 * 5;
  expect(counterBytesWithDetached).toBe(1_149_440);
  // Controlled cell/buffer accounting is not a universal JS object/GC heap guarantee.
  const accountedBytes = counterBytesWithDetached + 1_048_576 + 65_536 + 3 * bytes + 2 * maxSnapshotBytes;
  expect(accountedBytes).toBeLessThan(8_388_608);
  console.info(JSON.stringify({ w294ResourceEvidence: { trends: trends.length, retainedSeries: state.totals.size,
    counterBytesWithDetached, numericBytes: bytes, maxSnapshotBytes, accountedBytes,
    heapUsedDeltaObserved: process.memoryUsage().heapUsed - beforeHeap } }));
});
