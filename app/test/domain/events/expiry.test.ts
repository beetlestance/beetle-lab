import { expect, it } from 'vitest';
import { expiryCoverage } from '../../../src/domain/events/index.js';

it.each([[0, 101, 100], [50, 101, 100], [0, 100, 100],
  [Number.MAX_SAFE_INTEGER - 2, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1]])(
  'preserves a durable prefix covering stale expiry after%s/start%s/durable%s', (after, start, durable) => {
    expect(expiryCoverage(after!, start!, durable!)).toBe('covered');
  });
it.each([[0, 102, 100], [100, 102, 100],
  [Number.MAX_SAFE_INTEGER - 2, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 2]])(
  'recognizes only a gap beyond current durability after%s/start%s/durable%s', (after, start, durable) => {
    expect(expiryCoverage(after!, start!, durable!)).toBe('gap');
  });
it.each([[100, 101, 100], [100, 100, 100], [100, 99, 100], [101, 103, 100],
  [-1, 2, 0], [0, Infinity, 0], [0, 3, 0.5], [0, 3, Number.MAX_SAFE_INTEGER + 1],
  [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]])(
  'rejects invalid or internally inconsistent expiry after%s/start%s/durable%s', (after, start, durable) => {
    expect(() => expiryCoverage(after!, start!, durable!)).toThrow('invalid_batch');
  });
