import { expect, it } from 'vitest';
import { captureHistorical } from '../../src/bootstrap/historical.js';
import type { HistoricalOptions } from '../../src/bootstrap/historical.js';

const historical = {
  historyId: '0b5c2a4e-1f3d-4c6b-8a9e-7d2f1e0c3b4a',
  backup: { backupId: '1c9e3f2a-5b7d-4e8f-9a0b-2c4d6e8f0a1b', createdAt: '2026-11-19T00:00:00.000Z' },
} as unknown as HistoricalOptions;
const options = { externalOrigin: 'http://127.0.0.1:4568', localAccess: 'automatic' as const, historical,
  metadata: { readOnly: true as const, runtime: null } };

it('keeps the history viewer loopback-only: network access is refused (decision 032)', () => {
  expect(captureHistorical(options)).toBe(historical);
  expect(captureHistorical({ ...options, access: 'local' })).toBe(historical);
  expect(() => captureHistorical({ ...options, access: 'network' })).toThrow('Historical network access unavailable');
});
