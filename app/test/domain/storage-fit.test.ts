import { expect, it } from 'vitest';
import { storageFits } from '../../src/domain/settings/index.js';
it('fits exact safe boundaries without adding overflowing numbers', () => {
  expect(storageFits({ chargedBytes: 10, requestedBytes: 20, allocationBytes: 35, reserveBytes: 5 })).toBe(true);
  expect(storageFits({ chargedBytes: 10, requestedBytes: 21, allocationBytes: 35, reserveBytes: 5 })).toBe(false);
  expect(storageFits({ chargedBytes: Number.MAX_SAFE_INTEGER, requestedBytes: 1, allocationBytes: Number.MAX_SAFE_INTEGER, reserveBytes: 0 })).toBe(false);
  expect(storageFits({ chargedBytes: 0, requestedBytes: Number.MAX_SAFE_INTEGER, allocationBytes: Number.MAX_SAFE_INTEGER, reserveBytes: 0 })).toBe(true);
});
it('rejects every invalid numeric field', () => {
  for (const field of ['chargedBytes', 'requestedBytes', 'allocationBytes', 'reserveBytes']) {
    for (const invalid of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(storageFits({ chargedBytes: 0, requestedBytes: 1, allocationBytes: 100, reserveBytes: 0, [field]: invalid })).toBe(false);
    }
  }
});
