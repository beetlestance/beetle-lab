import { expect, it } from 'vitest';
import { captureRunMetricSamplesCursor, captureRunMetricSeriesCursor, encodeRunMetricSamplesCursor, encodeRunMetricSeriesCursor } from '../../src/api/index.js';
const p = {organizationId: '00000000-0000-4000-8000-000000000001', workspaceId: '00000000-0000-4000-8000-000000000002',
  runId: '00000000-0000-4000-8000-000000000005', attemptId: '00000000-0000-4000-8000-000000000006', manifestDigest: 'c'.repeat(64)};
it('uses exact canonical bounded tuples, lowercases UUIDs and rejects alternate encodings', () => {
  const value = encodeRunMetricSeriesCursor({...p, nextOrdinal: 1});
  expect(JSON.parse(atob(value))).toEqual(['metric-series-v1', p.organizationId, p.workspaceId, p.runId, p.attemptId, p.manifestDigest, 1]);
  expect(captureRunMetricSeriesCursor(value)).toEqual({...p, nextOrdinal: 1});
  for (const invalid of [value + '=', '', 'a'.repeat(513), btoa(JSON.stringify(['metric-series-v1', ...Object.values(p), 0]))])
    expect(() => captureRunMetricSeriesCursor(invalid)).toThrow();
});
it('binds samples range, ordinal and reverse position', () => {
  const position = {...p, seriesOrdinal: 4095, fromTimeMs: 0, toTimeMs: 8640000000000000, beforeWindow: 65536};
  const cursor = encodeRunMetricSamplesCursor(position); expect(cursor.length).toBeLessThanOrEqual(512);
  expect(captureRunMetricSamplesCursor(cursor)).toEqual(position);
  expect(() => encodeRunMetricSamplesCursor({...position, fromTimeMs: position.toTimeMs})).toThrow();
  expect(() => captureRunMetricSeriesCursor(cursor)).toThrow();
});
