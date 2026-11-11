import { expect, it } from 'vitest';
import { runMetricSamplesPageMatches, runMetricSeriesPageMatches, validateApi } from '../../src/api/index.js';
import { fixture } from './fixtures.js';
async function sample() { const p = validateApi('RunMetricSamplesPage', await fixture('valid/run-metric-samples.json')); if (!p.ok) throw new Error('fixture'); return p.value; }
it('binds sample identity, range, selection, arithmetic and real gaps', async () => {
  const p = await sample(); const q = {id: p.id, scope: p.scope, attemptId: p.attemptId, limit: 100, seriesOrdinal: 0};
  expect(runMetricSamplesPageMatches(p, q)).toBe(true);
  expect(runMetricSamplesPageMatches(p, {...q, seriesOrdinal: 1})).toBe(false);
  expect(runMetricSamplesPageMatches(p, {...q, fromTimeMs: 1})).toBe(false);
  expect(runMetricSamplesPageMatches({...p, attemptId: q.id}, q)).toBe(false);
  expect(runMetricSamplesPageMatches({...p, items: [{...p.items[0]!, value: {kind: 'rate', numerator: 1, sampleCount: 2, ratio: 0}}]}, q)).toBe(false);
});
it('keeps pending free of measurement claims', async () => {
  const p = validateApi('RunMetricSeriesPage', await fixture('valid/run-metric-series-pending.json')); if (!p.ok) throw new Error('fixture');
  const q = {id: p.value.id, scope: p.value.scope, attemptId: p.value.attemptId, limit: 100};
  expect(runMetricSeriesPageMatches(p.value, q)).toBe(true);
  expect(runMetricSeriesPageMatches({...p.value, windows: 1}, q)).toBe(false);
});
it('orders named percentiles independently of JSON insertion order', async () => {
  const p = await sample(); const q = {id: p.id, scope: p.scope, attemptId: p.attemptId, limit: 100, seriesOrdinal: 0};
  const total = p.series.total; if (total.kind !== 'trend') throw new Error('fixture');
  const estimate = (n: number) => ({source: 'histogram-estimate' as const, scale: 4, lower: n, upper: n, estimate: n});
  const ordered = {...total, count: 4, sum: 10, min: 1, max: 4, mean: 2.5,
    percentiles: {p99: estimate(4), p95: estimate(3), p90: estimate(2), p50: estimate(1)}};
  const page = {...p, series: {...p.series, total: ordered}, items: [{...p.items[0]!, value: ordered}]};
  expect(runMetricSamplesPageMatches(page, q)).toBe(true);
  expect(runMetricSamplesPageMatches({...page, series: {...page.series, total: {...ordered,
    percentiles: {...ordered.percentiles, p50: estimate(4), p99: estimate(1)}}}}, q)).toBe(false);
});
