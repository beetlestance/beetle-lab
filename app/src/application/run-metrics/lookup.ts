import { encodeJson } from '@beetle/contracts';
import { metricSeriesIdentity } from '@beetle/contracts/metrics';
import { validateApi } from '@beetle/contracts/api';
import type { RunMetricKey } from '@beetle/contracts/api';
import type { RunMetricLookupQuery, RunMetricLookupResult, RunMetricSeriesQuery } from '../../ports/run-metrics.js';
import { MetricReadError } from '../../ports/run-metrics.js';
import type { Publication } from './archive.js';
import { descriptor } from './values.js';

/** One source projection for catalogues and exact lookup, without materializing a catalogue page. */
export function metricSource(q: RunMetricSeriesQuery, p: Publication): RunMetricLookupResult['source'] {
  const base = {id: q.id, scope: q.scope, attemptId: q.attemptId, generation: 1 as const, manifestDigest: p.page.manifestDigest};
  if (!p.archive) return {...base, availability: p.page.availability === 'ready' ? 'unavailable' : p.page.availability,
    reason: p.reason, windows: 0, totalSeries: 0, measurementSourceTimeMs: null, coverage: null};
  const numeric = p.archive.numeric;
  return {...base, availability: 'ready', reason: null, windows: numeric.windows, totalSeries: numeric.totals.length,
    measurementSourceTimeMs: numeric.sourceTimeMs, coverage: numeric.coverage};
}
export function captureMetricKey(input: unknown): RunMetricKey {
  try {
    const checked = validateApi('RunMetricKey', JSON.parse(encodeJson(input, 2048)) as unknown);
    if (checked.ok) return checked.value;
  } catch { /* Fixed boundary error below. */ }
  throw new MetricReadError('invalid_input');
}
export function lookup(q: RunMetricSeriesQuery, p: Publication, key: RunMetricKey): RunMetricLookupResult {
  const source = metricSource(q, p); let series = null;
  if (p.archive) {
    const identity = metricSeriesIdentity(key);
    const ordinal = p.archive.numeric.totals.findIndex(item => metricSeriesIdentity(item) === identity);
    if (ordinal !== -1) series = descriptor(p.archive.numeric.totals[ordinal]!, ordinal);
  }
  return {source, series};
}

export function captureLookupQuery(input: unknown): RunMetricLookupQuery {
  try {
    const value = JSON.parse(encodeJson(input, 4096)) as RunMetricLookupQuery;
    if (!value || Object.keys(value).length !== 4 || Object.keys(value).some(k => !['id', 'scope', 'attemptId', 'metric'].includes(k))) throw new Error('shape');
    return {...value, metric: captureMetricKey(value.metric)};
  } catch {throw new MetricReadError('invalid_input');}
}
