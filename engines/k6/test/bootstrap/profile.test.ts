import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { K6_LIVE_METRIC_IMAGE_ENV } from '@beetle/contracts/k6-live';
import { imageOptions } from '../../bootstrap/profile.js';
afterEach(() => vi.unstubAllEnvs());
it('enables the wrapper only with the exact trusted versioned image marker', () => {
  vi.stubEnv(K6_LIVE_METRIC_IMAGE_ENV, undefined);
  expect(imageOptions(new AbortController().signal).liveMetricMailbox).toBe(false);
  vi.stubEnv(K6_LIVE_METRIC_IMAGE_ENV, '1');
  expect(imageOptions(new AbortController().signal).liveMetricMailbox).toBe(true);
  vi.stubEnv(K6_LIVE_METRIC_IMAGE_ENV, '2');
  expect(() => imageOptions(new AbortController().signal)).toThrow('Unsupported image');
});
it('ships the same versioned image marker without declaring a writable image volume', () => {
  const file = readFileSync('engines/k6/Dockerfile', 'utf8');
  expect(file).toContain(`${K6_LIVE_METRIC_IMAGE_ENV}=1`); expect(file).not.toMatch(/^VOLUME\b/m);
});
