import { expect, it } from 'vitest';
import { DurationHistogram } from '../metrics/index.js';
import type { SeriesTotal } from '../metrics/index.js';
import { summarizeK6HttpTotals, k6RequestsPerSecond } from './history.js';

function counter(request: string, sum: number): SeriesTotal {
  return { metric: 'http_reqs', kind: 'counter', scope: 'execute', tags: { phase: 'execute', request }, total: { kind: 'counter', sum } };
}
function trend(request: string, value: number, count: number): SeriesTotal {
  const histogram = new DurationHistogram();
  for (let i = 0; i < count; i++) histogram.record(value);
  return { metric: 'http_req_duration', kind: 'trend', scope: 'execute', tags: { phase: 'execute', request },
    total: { kind: 'trend', count, sum: count * value, min: value, max: value, mean: value, distribution: histogram.snapshot() } };
}
it('merges disjoint request histograms rather than averaging their percentiles', () => {
  const value = summarizeK6HttpTotals([counter('r0', 99), counter('r1', 1), trend('r0', 1, 99), trend('r1', 1000, 1)]);
  expect(value.requestCount).toBe(100); expect(value.httpP95?.estimate).toBeLessThan(2);
  expect(value.httpP95?.source).toBe('histogram-estimate'); expect(value.httpFailures).toBeNull();
  expect(k6RequestsPerSecond(value.requestCount, 2000)).toBe(50);
});
it('sums HTTP failure samples and excludes prepare, assertion, engine and unlabelled identities', () => {
  const failure: SeriesTotal = { metric: 'http_req_failed', kind: 'rate', scope: 'execute', tags: { phase: 'execute', request: 'r0' }, total: { kind: 'rate', numerator: 1, sampleCount: 4 } };
  const value = summarizeK6HttpTotals([counter('r0', 4), failure,
    { ...failure, tags: { phase: 'execute', request: 'r1' }, total: { kind: 'rate', numerator: 2, sampleCount: 6 } },
    { ...counter('r2', 90), tags: { phase: 'prepare', request: 'r2' }, scope: 'prepare' },
    { ...counter('r2', 90), tags: { phase: 'execute', request: 'r2', assertion: 'a0' } },
    { ...counter('r2', 90), scope: 'engine' }, { ...counter('r2', 90), tags: {} }]);
  expect(value).toMatchObject({ requestCount: 4, httpFailures: 3, httpSamples: 10, httpFailureRatio: 0.3, httpP95: null });
});
it('preserves absent/zero facts and rejects duplicate or overflowed totals', () => {
  expect(summarizeK6HttpTotals([])).toMatchObject({ requestCount: null, httpP95: null, httpFailureRatio: null });
  expect(summarizeK6HttpTotals([counter('r0', 0)]).requestCount).toBe(0);
  expect(() => summarizeK6HttpTotals([counter('r0', 1), counter('r0', 1)])).toThrow();
  expect(() => summarizeK6HttpTotals([counter('r0', Number.MAX_SAFE_INTEGER), counter('r1', 1)])).toThrow();
  expect(k6RequestsPerSecond(null, 1000)).toBeNull(); expect(k6RequestsPerSecond(1, null)).toBeNull();
  expect(k6RequestsPerSecond(1, 0)).toBeNull(); expect(k6RequestsPerSecond(1, 1e-320)).toBeNull();
  expect(k6RequestsPerSecond(0, 1000)).toBe(0);
});
