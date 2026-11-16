import { expect, it } from 'vitest';
import { cacheMatches } from './worker-cache.js';
it('rejects absent or stale dependency source/cache identities before bundle reuse', () => {
  const source = { fingerprint: 'a'.repeat(64), files: 10, bytes: 100 };
  const bundleSha256 = 'b'.repeat(64);
  const metadata = { version: 1, ...source, bundleSha256 };
  expect(cacheMatches(metadata, source, bundleSha256)).toBe(true);
  expect(cacheMatches(null, source, bundleSha256)).toBe(false);
  expect(cacheMatches(metadata, { ...source, fingerprint: 'c'.repeat(64) }, bundleSha256)).toBe(false);
  expect(cacheMatches(metadata, { ...source, bytes: 101 }, bundleSha256)).toBe(false);
  expect(cacheMatches(metadata, source, 'd'.repeat(64))).toBe(false);
});
