import { expect, it } from 'vitest';
import { MetricStream, createK6MetricProfile } from '../../../aggregation/index.js';
import { compiled } from '../../suite/fixtures.js';
import { marker, point, setup, signal } from './fixtures.js';

it('arbitrarily large preparation never changes measured totals, source highwater, lateness or windows', async () => {
  const run = async (prepare: boolean) => {
    const { accumulator, feed, windows, profile } = setup();
    if (prepare) {
      for (const entry of profile.allowedSeries.filter(item => item.scope === 'prepare')) {
        await feed({ metric: entry.metric, kind: entry.kind, tags: entry.tags,
          value: entry.kind === 'rate' ? 1 : 1_000_000_000, timeMs: 1_000_000_000 });
      }
    }
    await feed(marker()); await feed(point('beetle_requests', 2, 2000));
    await feed(point('beetle_requests', 3, 4000));
    const snapshot = await accumulator.finish(signal());
    return { snapshot, windows };
  };
  expect(await run(true)).toEqual(await run(false));
});
it('bounds a delayed-marker prefix while preserving totals and explicit gap evidence', async () => {
  const { accumulator, feed, windows } = setup();
  for (let second = 1; second <= 100; second++) await feed(point('beetle_requests', 1, second * 1000));
  expect(windows).toEqual([]);
  const state = accumulator as unknown as { windows: { buckets: Map<number, unknown> }; totals: Map<string, unknown> };
  expect(state.windows.buckets.size).toBe(3); expect(state.totals.size).toBe(1);
  await feed(marker());
  const result = await accumulator.finish(signal());
  expect(result.totals[0]!.total).toEqual({ kind: 'counter', sum: 100 });
  expect(result.windowCoverage).toEqual({ complete: false, latePoints: 0, markerDelayDroppedBuckets: 97 });
  expect(windows.map(item => item.startTimeMs)).toEqual([98_000, 99_000, 100_000]);
});
it('retains source-valid reordered execute buckets without early publication or fake gaps', async () => {
  const { accumulator, feed, windows } = setup();
  await feed(point('beetle_requests', 1, 1500)); await feed(point('beetle_requests', 2, 2000));
  expect(windows).toEqual([]); await feed(marker());
  const result = await accumulator.finish(signal());
  expect(result.windowCoverage).toEqual({ complete: true, latePoints: 0, markerDelayDroppedBuckets: 0 });
  expect(windows.map(item => item.startTimeMs)).toEqual([1000, 2000]);
});
it('marks contradictory source correlation incomplete by failing measurement, and never fabricates gauge carry', async () => {
  const bad = setup(); await bad.feed(point('beetle_requests', 1, 999));
  await expect(bad.accumulator.point(marker(), signal())).rejects.toMatchObject({ code: 'measurement' });
  const { accumulator, feed, windows } = setup();
  await feed(point('vus', 9, 500)); await feed(marker());
  await feed(point('vus', 3, 900)); await feed(point('vus', 2, 1500));
  const result = await accumulator.finish(signal());
  expect(result.totals[0]).toMatchObject({ scope: 'engine', total: { latest: 2, sourceTimeMs: 1500, min: 2, max: 9 } });
  expect(windows).toHaveLength(1);
  expect(windows[0]!.series[0]).toMatchObject({ scope: 'engine', total: { min: 2, max: 2, latest: 2, sourceTimeMs: 1500 } });
});
it.each([
  ['beetle_requests', {}], ['beetle_requests', { phase: 'execute', request: 'r5' }],
  ['beetle_requests', { phase: 'prepare', request: 'r0' }], ['vus', { phase: 'execute' }],
  ['http_req_duration', { phase: 'execute', assertion: 'a0' }], ['iterations', { phase: 'prepare' }],
  ['beetle_requests', { phase: 'other', request: 'r0' }], ['beetle_measure_started', { phase: 'prepare' }],
] as const)('rejects impossible native combination %s/%j', async (metric, tags) => {
  const profile = createK6MetricProfile(compiled());
  const stream = new MetricStream({ ...profile, maximumBytes: 4096, maximumRecords: 10, point: async () => {} });
  const kind = profile.metrics.find(item => item.name === metric)!.kind;
  const records = [{ type: 'Metric', metric, data: { type: kind } },
    { type: 'Point', metric, data: { time: '1970-01-01T00:00:01Z', value: 1, tags } }];
  await expect(stream.push(new TextEncoder().encode(records.map(item => JSON.stringify(item)).join('\n') + '\n'), signal()))
    .rejects.toMatchObject({ code: 'invalid_labels' });
});
it('requires the exact production profile instead of falling back to singleton admission', () => {
  const profile = createK6MetricProfile(compiled());
  const without = { metrics: profile.metrics, requestLabels: profile.requestLabels, assertionLabels: profile.assertionLabels };
  expect(() => new MetricStream({ ...without, maximumBytes: 4096, maximumRecords: 10, point: async () => {} }))
    .toThrowError(expect.objectContaining({ code: 'invalid_profile' }));
});
