import {expect, it} from 'vitest';
import {readFailed} from './observe.js';
import {capture, summarize, percentile} from './measure.js';
const id = 'a'.repeat(64);
const row = {cpu_stats: {cpu_usage: {total_usage: 100000000}}, memory_stats: {usage: 1000, stats: {anon: 800}}};
it('keeps actual anonymous bytes distinct from total Docker memory and unknown', () => {
  expect(capture(row, id, 1)).toEqual({at: 1, cpuNanos: 100000000, memoryBytes: 1000, anonymousBytes: 800});
  expect(capture({...row, memory_stats: {usage: 1000, stats: {}}}, id, 1).anonymousBytes).toBeNull();
});
it('accepts omitted body IDs only under an exact full-ID request and rejects contradictory or invalid counters', () => {
  expect(() => capture({...row, id: 'b'.repeat(64)}, id, 1)).toThrow();
  expect(() => capture({...row, id: null}, id, 1)).toThrow(); expect(() => capture(row, 'short', 1)).toThrow();
  expect(() => capture({...row, memory_stats: {usage: -1, stats: {}}}, id, 1)).toThrow();
});
it('uses a one-core CPU denominator and refuses counter reset or ceiling violations', () => {
  const first = capture(row, id, 0); const last = {...first, at: 1000, cpuNanos: first.cpuNanos + 500000000};
  expect(summarize([first, last], 1000).cpuOneCorePercent).toBe(50);
  expect(() => summarize([first, {...last, cpuNanos: 0}], 1000)).toThrow();
  expect(() => summarize([first, last], 999)).toThrow();
});
it('uses nearest-rank percentiles and refuses empty, unbounded or invalid timing samples', () => {
  expect(percentile([4, 1, 3, 2], 0.95)).toBe(4); expect(percentile([4, 1, 3, 2], 0.5)).toBe(2);
  for (const values of [[], [NaN], [-1], Array.from({length: 513}, () => 1)]) expect(() => percentile(values, 0.95)).toThrow();
});

it('counts transient control-read failures while refusing auth and schema errors', () => {
  expect(readFailed({ok: true, value: null})).toBe(false);
  expect(readFailed({ok: false, error: {kind: 'timeout'}})).toBe(true);
  expect(readFailed({ok: false, error: {kind: 'response', status: 503}})).toBe(true);
  expect(() => readFailed({ok: false, error: {kind: 'response', status: 401}})).toThrow();
});
