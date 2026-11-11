import { expect, it } from 'vitest';
import { validateApi } from '../../src/api/index.js';
import { fixture } from './fixtures.js';

it('validates pending catalogue and measured history without permitting byte selectors', async () => {
  const pending = await fixture('valid/run-metric-series-pending.json');
  const measured = await fixture('valid/run-metric-samples.json');
  expect(validateApi('RunMetricSeriesPage', pending).ok).toBe(true);
  expect(validateApi('RunMetricSamplesPage', measured).ok).toBe(true);
  expect(validateApi('RunMetricSamplesPage', { ...measured as object, offset: 0 }).ok).toBe(false);
});
it('bounds history selection and rejects implicit query coercion', () => {
  const query = { seriesOrdinal: 0, limit: 100 };
  expect(validateApi('RunMetricSamplesQuery', query).ok).toBe(true);
  for (const invalid of [{ ...query, limit: 101 }, { ...query, seriesOrdinal: 4096 },
    { ...query, limit: '100' }, { ...query, fromTimeMs: -1 }, { ...query, cursor: '../file' }]) {
    expect(validateApi('RunMetricSamplesQuery', invalid).ok).toBe(false);
  }
});
