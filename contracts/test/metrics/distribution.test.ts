import { expect, it } from 'vitest';
import { DurationHistogram, distributionPercentile, mergeDistributions } from '../../src/metrics/index.js';
import type { DurationDistribution } from '../../src/metrics/index.js';

function histogram(values: readonly number[]): DurationDistribution {
  const histogram = new DurationHistogram();
  for (const value of values) histogram.record(value);
  return histogram.snapshot();
}
function next(value: number, up: boolean): number {
  const bits = new DataView(new ArrayBuffer(8)); bits.setFloat64(0, value);
  bits.setBigUint64(0, bits.getBigUint64(0) + (up ? 1n : -1n));
  return bits.getFloat64(0);
}
function check(values: readonly number[], distribution = histogram(values)): void {
  const sorted = [...values].sort((a, b) => a - b);
  expect(distribution.count).toBe(values.length);
  expect(distribution.buckets.reduce((sum, n) => sum + n, distribution.zeroCount)).toBe(values.length);
  expect(distribution.buckets.length).toBeLessThanOrEqual(64);
  for (const percentile of [50, 90, 95, 99] as const) {
    const quantile = distributionPercentile(distribution, percentile)!;
    const expected = sorted[Math.ceil(sorted.length * percentile / 100) - 1]!;
    expect(quantile.lower).toBeLessThanOrEqual(expected);
    expect(quantile.upper).toBeGreaterThanOrEqual(expected);
    expect(quantile.estimate).toBeGreaterThanOrEqual(quantile.lower);
    expect(quantile.estimate).toBeLessThanOrEqual(quantile.upper);
    expect([quantile.lower, quantile.upper, quantile.estimate].every(Number.isFinite)).toBe(true);
    expect(quantile).toMatchObject({ source: 'histogram-estimate', scale: distribution.scale });
  }
}
it('distinguishes empty, measured zero, and exact singleton populations', () => {
  expect(distributionPercentile(histogram([]), 95)).toBeNull();
  expect(histogram([0, 0])).toMatchObject({ count: 2, zeroCount: 2, buckets: [], min: 0, max: 0, scale: 4 });
  for (const value of [0, Number.MIN_VALUE, 7, Number.MAX_VALUE]) {
    expect(distributionPercentile(histogram([value, value]), 95)).toMatchObject({ estimate: value, lower: value, upper: value });
  }
});
it('maps exact powers of two and both neighbouring doubles, including subnormals', () => {
  for (const exponent of [-1074, -1073, -1022, -100, -1, 0, 1, 100, 1023]) {
    const value = 2 ** exponent;
    const center = histogram([value]);
    expect(center.offset).toBe(exponent * 16 - 1);
    if (exponent >= -1022) expect(histogram([next(value, true)]).offset).toBe(exponent * 16);
    if (exponent > -1022) expect(histogram([next(value, false)]).offset).toBe(exponent * 16 - 1);
    check([value, next(value, true)]);
  }
  expect(histogram([Number.MAX_VALUE]).offset).toBe(16383);
});
it('independently checks every fractional scale4 edge with exact integer powers', () => {
  for (let edge = 1; edge < 16; edge++) {
    const rounded = 2 ** (edge / 16);
    for (const value of [next(rounded, false), rounded, next(rounded, true)]) {
      const left = BigInt(value * 2 ** 52) ** 16n;
      const right = 1n << BigInt(832 + edge);
      expect(histogram([value]).offset).toBe(left <= right ? edge - 1 : edge);
    }
    check([next(rounded, false), rounded, next(rounded, true)]);
  }
});
it('downscales across all finite extremes without losing zero or samples', () => {
  const values = [0, Number.MIN_VALUE, 2 ** -1022, 2 ** -100, 0.5, 1, 100, 2 ** 1023, Number.MAX_VALUE];
  const h = histogram(values); expect(h.scale).toBeLessThan(4); expect(h.scale).toBeGreaterThanOrEqual(-10);
  check(values, h);
  expect(h.min).toBe(0); expect(h.max).toBe(Number.MAX_VALUE);
  expect(JSON.parse(JSON.stringify(h))).toEqual(h);
});
it('checks sorted rank intervals for skewed, repeated and broad deterministic samples', () => {
  const populations = [Array.from({ length: 1000 }, (_, i) => i < 970 ? 1 : 10000 + i),
    Array.from({ length: 1000 }, (_, i) => i % 11),
    Array.from({ length: 3000 }, (_, i) => 2 ** (((i * 1543) % 2097) - 1073))];
  for (const values of populations) check(values);
});
it('merges populations at a common scale and computes combined ranks rather than averaged p95', () => {
  const a = Array.from({ length: 100 }, () => 1);
  const b = Array.from({ length: 10 }, () => 1000);
  const left = histogram(a); const right = histogram(b);
  const merged = mergeDistributions(left, right);
  check([...a, ...b], merged);
  expect(distributionPercentile(merged, 95)!.lower).toBeGreaterThan((1 + 1000) / 2);
  expect(mergeDistributions(right, left)).toEqual(merged);
  expect(mergeDistributions(merged, histogram([]))).toEqual(merged);
  const broad = [Number.MIN_VALUE, Number.MAX_VALUE];
  check([...a, ...b, ...broad], mergeDistributions(merged, histogram(broad)));
  expect(left).toEqual(histogram(a)); expect(right).toEqual(histogram(b));
});
it('detaches and deeply freezes snapshots; rejected records leave state unchanged', () => {
  const h = new DurationHistogram(); h.record(1); const before = h.snapshot();
  for (const value of [-1, NaN, Infinity, -Infinity]) {
    expect(() => h.record(value)).toThrowError(expect.objectContaining({ code: 'invalid_value' }));
    expect(h.snapshot()).toEqual(before);
  }
  h.record(2); expect(before.count).toBe(1); expect(before.buckets).toEqual([1]);
  expect(Object.isFrozen(before)).toBe(true); expect(Object.isFrozen(before.buckets)).toBe(true);
  expect(Reflect.set(before.buckets, '0', 4)).toBe(false);
});
it('keeps nearest-rank arithmetic exact at safe-integer count boundaries', () => {
  const count = Number.MAX_SAFE_INTEGER;
  const rank = Number((BigInt(count) * 95n + 99n) / 100n);
  const snapshot = { ...histogram([0, 1]), count, zeroCount: rank - 1, buckets: [count - rank + 1] };
  expect(distributionPercentile(snapshot, 95)!.estimate).toBeGreaterThan(0);
  expect(distributionPercentile({ ...snapshot, zeroCount: rank, buckets: [count - rank] }, 95)!.estimate).toBe(0);
  expect(() => mergeDistributions(snapshot, histogram([1]))).toThrowError(expect.objectContaining({ code: 'overflow' }));
  expect(snapshot.count).toBe(count);
});
it('rejects malformed shapes before oversized array iteration and preserves valid input on failed merge', () => {
  const valid = histogram([1, 2]);
  const oversized: number[] = []; oversized.length = 1_000_000;
  Object.defineProperty(oversized, '0', { get() { throw new Error('must not read'); } });
  const malformed = [null, {}, { ...valid, other: 1 }, { ...valid, unit: 'seconds' }, { ...valid, format: 'other' },
    { ...valid, scale: -11 }, { ...valid, scale: 5 }, { ...valid, offset: 1.5 }, { ...valid, buckets: oversized },
    { ...valid, buckets: [0] }, { ...valid, buckets: [-1] }, { ...valid, count: 3 }, { ...valid, count: Infinity },
    { ...valid, min: null }, { ...valid, max: NaN }, { ...valid, zeroCount: 1 }, { ...valid, min: 0 },
    { ...valid, offset: 100 }, { ...valid, buckets: new Float64Array(1) },
    Object.defineProperty({ ...valid }, 'hidden', { value: 1 }), { ...valid, [Symbol('extra')]: 1 }];
  for (const value of malformed) {
    expect(() => mergeDistributions(valid, value)).toThrow();
    expect(() => distributionPercentile(value, 95)).toThrow();
  }
  expect(valid).toEqual(histogram([1, 2]));
});

it('rejects unattainable positive indices even when zeros hide the positive minimum', () => {
  const buckets = Array.from({ length: 64 }, (_, i) => i === 0 || i === 63 ? 1 : 0);
  const impossible = { format: 'exponential-v1', unit: 'ms', scale: -10, offset: -63,
    buckets, min: 0, max: 2, zeroCount: 1, count: 3 };
  expect(() => distributionPercentile(impossible, 95)).toThrowError(expect.objectContaining({ code: 'invalid_distribution' }));
  expect(() => mergeDistributions(histogram([0]), impossible)).toThrow();
});
it('updates fixed counters in place on repeated records without retaining samples', () => {
  const histogram = new DurationHistogram(); histogram.record(1);
  const state = histogram as unknown as { counters: Float64Array };
  const counters = state.counters;
  for (let i = 0; i < 10000; i++) histogram.record(1);
  expect(state.counters).toBe(counters); expect(counters.byteLength).toBe(512);
  expect(histogram.snapshot()).toMatchObject({ count: 10001, buckets: [10001], min: 1, max: 1 });
});
