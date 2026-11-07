import { expect, it } from 'vitest';
import { SeriesBuffer } from './series-buffer.js';

it('keeps the newest bounded observations in time order across many wraps', () => {
  const series = new SeriesBuffer<number | null>(3);
  expect(series.snapshot()).toEqual([]);
  for (let i = 0; i < 1000; i++) series.push(i);
  series.push(null);
  expect(series.snapshot()).toEqual([998, 999, null]);
  series.snapshot().push(1001);
  expect(series.snapshot()).toEqual([998, 999, null]);
  series.clear();
  series.push(4);
  expect(series.snapshot()).toEqual([4]);
});

it.each([0, -1, 1.2, Infinity, 100001])('rejects unbounded/invalid capacity %s', capacity => {
  expect(() => new SeriesBuffer(capacity)).toThrow(RangeError);
});
