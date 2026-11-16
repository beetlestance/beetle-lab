import { expect, it } from 'vitest';
import { accumulate, checkedSum } from '../../../aggregation/totals.js';
import { DurationHistogram } from '../../../aggregation/index.js';
import type { AccumulatedSeries } from '../../../aggregation/snapshot.js';
import { point } from './fixtures.js';

it('checks safe-integer counts and finite sums at the arithmetic boundary', () => {
  expect(checkedSum(Number.MAX_SAFE_INTEGER - 1, 1, true)).toBe(Number.MAX_SAFE_INTEGER);
  expect(() => checkedSum(Number.MAX_SAFE_INTEGER, 1, true)).toThrowError(expect.objectContaining({ code: 'overflow' }));
  expect(() => checkedSum(Number.MAX_VALUE, Number.MAX_VALUE)).toThrowError(expect.objectContaining({ code: 'overflow' }));
});

it('fails series-cap exhaustion without evicting an existing measured series', () => {
  const series = new Map<string, AccumulatedSeries>();
  accumulate(series, point(), 1);
  accumulate(series, point('beetle_requests', 2), 1);
  expect(() => accumulate(series, point('vus'), 1)).toThrowError(expect.objectContaining({ code: 'series_limit' }));
  expect(series.size).toBe(1); expect([...series.values()][0]!.total).toEqual({ kind: 'counter', sum: 3 });
});

it.each(['trend', 'rate'] as const)('fails %s sample-count overflow with no partial replacement', kind => {
  const metric = kind === 'trend' ? 'http_req_duration' : 'http_req_failed';
  const series = new Map<string, AccumulatedSeries>();
  const input = point(metric);
  accumulate(series, input, 1);
  const key = [...series.keys()][0]!;
  const original = series.get(key)!;
  const total = kind === 'trend'
    ? { kind, count: Number.MAX_SAFE_INTEGER, sum: 1, min: 1, max: 1, mean: 1, distribution: new DurationHistogram() }
    : { kind, sampleCount: Number.MAX_SAFE_INTEGER, numerator: 1 };
  series.set(key, { ...original, total });
  expect(() => accumulate(series, input, 1)).toThrowError(expect.objectContaining({ code: 'overflow' }));
  expect(series.get(key)!.total).toBe(total);
});
