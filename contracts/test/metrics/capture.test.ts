import { expect, it } from 'vitest';
import { captureMetricSeries, captureMetricWindow, DurationHistogram, metricSeriesIdentity } from '../../src/metrics/index.js';
const counter = {metric: 'http_reqs', kind: 'counter', scope: 'execute', tags: {}, total: {kind: 'counter', sum: 0}};
it('captures measured positive zero, strict tags and immutable dimensions', () => {
  const result = captureMetricSeries(counter); expect(result.total).toEqual({kind: 'counter', sum: 0});
  expect(metricSeriesIdentity(result)).toBe(metricSeriesIdentity({...result, total: {kind: 'counter', sum: 10}}));
  for (const value of [{...counter, extra: true}, {...counter, scope: 'prepare'}, {...counter, tags: {phase: 'prepare'}},
    {...counter, total: {kind: 'counter', sum: -0}}, {...counter, total: {kind: 'rate', numerator: 2, sampleCount: 1}}]) {
    expect(() => captureMetricSeries(value)).toThrow();
  }
});
it('binds trend distribution and permits exact floating mean roundoff', () => {
  const histogram = new DurationHistogram(); histogram.record(0.1); histogram.record(0.2);
  const total = {kind: 'trend', count: 2, sum: 0.1 + 0.2, min: 0.1, max: 0.2, mean: (0.1 + 0.2) / 2, distribution: histogram.snapshot()};
  expect(captureMetricSeries({...counter, kind: 'trend', total}).total).toEqual(total);
  expect(() => captureMetricSeries({...counter, kind: 'trend', total: {...total, count: 3}})).toThrow();
});
it('rejects malformed windows, duplicate identities, getters and oversized arrays', () => {
  const window = {startTimeMs: 1000, endTimeMs: 2000, series: [counter]};
  expect(captureMetricWindow(window).series).toHaveLength(1);
  for (const value of [{...window, series: [counter, counter]}, {...window, endTimeMs: 2001}, {...window, series: Array(4097)}])
    expect(() => captureMetricWindow(value)).toThrow();
  expect(() => captureMetricSeries({...counter, get total() { throw new Error('getter invoked'); }})).toThrow('Invalid metric value');
});
it('rejects inherited optional getters without invoking them', () => {
  let invoked = false;
  const tags: unknown = Object.create({get phase() {invoked = true; return 'execute';}});
  expect(() => captureMetricSeries({...counter, tags})).toThrow(); expect(invoked).toBe(false);
});
it('rejects impossible single-observation and zero-only trend sums', () => {
  const h = new DurationHistogram(); h.record(3);
  expect(() => captureMetricSeries({...counter, kind: 'trend', total: {kind: 'trend', count: 1, sum: 1, mean: 1, min: 3, max: 3, distribution: h.snapshot()}})).toThrow();
  const z = new DurationHistogram(); z.record(0); z.record(0);
  expect(() => captureMetricSeries({...counter, kind: 'trend', total: {kind: 'trend', count: 2, sum: 2, mean: 1, min: 0, max: 0, distribution: z.snapshot()}})).toThrow();
});
