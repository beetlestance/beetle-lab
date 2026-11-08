import { expect, it } from 'vitest';
import { MetricAccumulator, createK6MetricProfile } from '../../../aggregation/index.js';
import { metricEvidenceLayout } from '../../../plan/index.js';
import { compiled } from '../../suite/fixtures.js';
import { marker, point, setup, signal } from './fixtures.js';

it('decodes exact totals, keeps zero distinct from missing, and chooses gauges by source time', async () => {
  const { feed, stream, accumulator, windows } = setup();
  await feed(marker());
  await feed(point('beetle_requests', 0));
  await feed(point('http_req_failed', 1)); await feed(point('http_req_failed', 0));
  await feed(point('http_req_duration', 3)); await feed(point('http_req_duration', 9));
  await feed(point('vus', 8, 2500)); await feed(point('vus', 2, 1500));
  stream.finish();
  const result = await accumulator.finish(signal());
  expect(result.totals.map(item => [item.metric, item.total])).toEqual([
    ['beetle_requests', { kind: 'counter', sum: 0 }],
    ['http_req_failed', { kind: 'rate', numerator: 1, sampleCount: 2 }],
    ['http_req_duration', { kind: 'trend', count: 2, sum: 12, min: 3, max: 9, mean: 6 }],
    ['vus', { kind: 'gauge', latest: 8, sourceTimeMs: 2500, min: 2, max: 8 }],
  ]);
  expect(result).toMatchObject({ totalsComplete: true, measurement: { complete: true, sourceTimeMs: 1000 },
    windowCoverage: { complete: true, latePoints: 0 }, quantiles: 'unknown' });
  expect(windows.map(window => window.startTimeMs)).toEqual([1000, 2000]);
});

it('uses rounded decoder source timestamps, exact bucket edges, bounded lateness and sparse gaps', async () => {
  const { accumulator, feed, windows } = setup();
  await feed(marker());
  await feed(point('beetle_requests', 1), '1970-01-01T00:00:01.999999999Z');
  await feed(point('beetle_requests', 2, 2000));
  await feed(point('beetle_requests', 4, 3000));
  await feed(point('beetle_requests', 8, 1000)); // exactly two source buckets behind
  expect(windows).toHaveLength(0);
  await feed(point('beetle_requests', 16, 4000));
  await feed(point('beetle_requests', 32, 1999)); // closed bucket: totals only
  await feed(point('beetle_requests', 64, 1_000_000_000));
  const result = await accumulator.finish(signal());
  expect(windows.map(window => [window.startTimeMs, window.series[0]!.total])).toEqual([
    [1000, { kind: 'counter', sum: 9 }], [2000, { kind: 'counter', sum: 2 }],
    [3000, { kind: 'counter', sum: 4 }], [4000, { kind: 'counter', sum: 16 }],
    [1_000_000_000, { kind: 'counter', sum: 64 }],
  ]);
  expect(result.totals[0]!.total).toEqual({ kind: 'counter', sum: 127 });
  expect(result.windowCoverage).toEqual({ complete: false, latePoints: 1, markerDelayDroppedBuckets: 0 });
});

it('snapshots compiler provenance and deeply freezes profiles and outputs', async () => {
  const suite = structuredClone(compiled()); const profile = createK6MetricProfile(suite);
  const id = profile.requests[0]!.id; suite.requests[0]!.id = 'changed';
  expect(profile.requests[0]!.id).toBe(id);
  expect(profile.maximumSeries).toBe(metricEvidenceLayout(compiled()).series.length);
  expect(Reflect.set(profile.requestLabels, '0', 'r999')).toBe(false);
  expect(Object.isFrozen(profile.metrics[0])).toBe(true);
  expect(Object.isFrozen(profile.assertions[0])).toBe(true);
  expect(() => new MetricAccumulator({ profile: { ...profile }, window: async () => {} }))
    .toThrowError(expect.objectContaining({ code: 'invalid_profile' }));
  const { accumulator, feed, windows } = setup();
  await feed(marker()); await feed(point());
  const result = await accumulator.finish(signal());
  for (const value of [result, result.totals, result.totals[0], result.totals[0]!.tags,
    result.totals[0]!.total, result.measurement, result.windowCoverage, windows[0], windows[0]!.series]) {
    expect(Object.isFrozen(value)).toBe(true);
  }
});

it('enforces exactly 2000ms lateness even inside the oldest still-open bucket', async () => {
  const { accumulator, feed, windows } = setup();
  await feed(marker()); await feed(point('beetle_requests', 1, 3999));
  await feed(point('beetle_requests', 2, 1999));
  await feed(point('beetle_requests', 4, 1998));
  const result = await accumulator.finish(signal());
  expect(result.totals[0]!.total).toEqual({ kind: 'counter', sum: 7 });
  expect(result.windowCoverage).toEqual({ complete: false, latePoints: 1, markerDelayDroppedBuckets: 0 });
  expect(windows.map(window => [window.startTimeMs, window.series[0]!.total])).toEqual([
    [1000, { kind: 'counter', sum: 2 }], [3000, { kind: 'counter', sum: 1 }],
  ]);
});

it('admits every exact native series at the unchanged200-label boundary and rejects impossible combinations', async () => {
  const suite = structuredClone(compiled()); const request = suite.requests[0]!;
  suite.requests = Array.from({ length: 199 }, (_, index) => ({ ...request, id: `req${index}`, assertions: [] }));
  delete suite.readiness;
  const profile = createK6MetricProfile(suite);
  expect(profile.maximumSeries).toBe(profile.allowedSeries.length);
  expect(profile.maximumSeries).toBeLessThanOrEqual(4600);
  const accumulator = new MetricAccumulator({ profile, window: async () => {} });
  await accumulator.point(marker(), signal());
  for (const entry of profile.allowedSeries) {
    if (entry.metric === 'beetle_measure_started') continue;
    await accumulator.point({ metric: entry.metric, kind: entry.kind, value: 1, timeMs: 1000, tags: entry.tags }, signal());
  }
  expect((await accumulator.finish(signal())).totals).toHaveLength(profile.allowedSeries.filter(item => item.scope !== 'prepare' && item.scope !== 'control').length);
  const bad = setup().accumulator;
  await expect(bad.point(point('beetle_requests', 1, 1000, { request: 'r999' }), signal()))
    .rejects.toMatchObject({ code: 'invalid_point' });
  suite.requests.push({ ...request, id: 'overflow', assertions: [] });
  expect(() => createK6MetricProfile(suite)).toThrow('metric_limit');
});

it('bounds retained buckets and series across a long decoder-fed stream without storing history', async () => {
  let emitted = 0;
  const { accumulator, feed } = setup(async window => {
    expect(window.series).toHaveLength(1); emitted++;
  });
  await feed(marker());
  for (let index = 0; index < 10_000; index++) await feed(point('beetle_requests', 1, (index + 1) * 1000));
  // Inspect owned state to verify the bound, independently of the output count.
  const state = accumulator as unknown as { totals: Map<unknown, unknown>;
    windows: { buckets: Map<number, Map<unknown, unknown>> } };
  expect(state.totals.size).toBe(1); expect(state.windows.buckets.size).toBe(3);
  expect([...state.windows.buckets.values()].map(bucket => bucket.size)).toEqual([1, 1, 1]);
  expect(emitted).toBe(9997);
  expect((await accumulator.finish(signal())).totals[0]!.total).toEqual({ kind: 'counter', sum: 10_000 });
  expect(emitted).toBe(10_000); expect(state.windows.buckets.size).toBe(0);
});

it.each([
  ['beetle_requests', Number.MAX_SAFE_INTEGER, 1],
  ['http_req_duration', Number.MAX_VALUE, Number.MAX_VALUE],
] as const)('fails numeric overflow for %s without infinity or clamping', async (metric, first, second) => {
  const { accumulator, feed } = setup();
  await feed(marker()); await feed(point(metric, first));
  await expect(accumulator.point(point(metric, second), signal())).rejects.toMatchObject({ code: 'overflow' });
  await expect(accumulator.finish(signal())).rejects.toMatchObject({ code: 'overflow' });
});

it('requires one exact marker and rejects malformed/duplicate/missing evidence', async () => {
  const missing = setup().accumulator;
  await expect(missing.finish(signal())).rejects.toMatchObject({ code: 'measurement' });
  for (const malformed of [point('beetle_measure_started', 0), point('beetle_measure_started', 2),
    { ...marker(), kind: 'gauge' as const }, point('beetle_measure_started', 1, 1000, { request: 'r0' })]) {
    await expect(setup().accumulator.point(malformed, signal())).rejects.toMatchObject({ code: 'measurement' });
  }
  const { accumulator, feed } = setup();
  await feed(marker());
  await expect(accumulator.point(marker(), signal())).rejects.toMatchObject({ code: 'measurement' });
});
