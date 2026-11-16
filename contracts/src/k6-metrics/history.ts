import { distributionPercentile, mergeDistributions, metricSeriesIdentity } from '../metrics/index.js';
import type { DurationDistribution, PercentileEstimate, SeriesTotal } from '../metrics/index.js';

export class K6HttpSummaryError extends Error { constructor() { super('Invalid HTTP summary evidence'); } }
export interface K6HttpSummary {
  requestCount: number | null;
  httpFailures: number | null;
  httpSamples: number | null;
  httpFailureRatio: number | null;
  httpP95: PercentileEstimate | null;
}
interface Totals {
  requestCount: number | null;
  failures: number | null;
  samples: number | null;
  duration: DurationDistribution | null;
}
function add(left: number | null, right: number): number {
  const value = (left ?? 0) + right;
  if (!Number.isSafeInteger(value) || value < 0) throw new K6HttpSummaryError();
  return value;
}
function executeRequest(series: SeriesTotal): boolean {
  return series.scope === 'execute' && series.tags.phase === 'execute'
    && typeof series.tags.request === 'string' && /^r[0-9]{1,3}$/.test(series.tags.request)
    && series.tags.assertion === undefined;
}
function accumulate(totals: Totals, series: SeriesTotal): void {
  const value = series.total;
  switch (series.metric) {
    case 'http_reqs':
      if (value.kind !== 'counter') throw new K6HttpSummaryError();
      totals.requestCount = add(totals.requestCount, value.sum); return;
    case 'http_req_failed':
      if (value.kind !== 'rate') throw new K6HttpSummaryError();
      totals.failures = add(totals.failures, value.numerator);
      totals.samples = add(totals.samples, value.sampleCount); return;
    case 'http_req_duration':
      if (value.kind !== 'trend') throw new K6HttpSummaryError();
      totals.duration = totals.duration ? mergeDistributions(totals.duration, value.distribution) : value.distribution;
  }
}
/** Previously captured unique numeric totals. Request labels partition native
 * HTTP samples; prepare/assertion/engine identities never enter this projection. */
export function summarizeK6HttpTotals(series: readonly SeriesTotal[]): K6HttpSummary {
  if (series.length > 4096) throw new K6HttpSummaryError();
  const seen = new Set<string>();
  const totals: Totals = { requestCount: null, failures: null, samples: null, duration: null };
  for (const item of series) {
    const identity = metricSeriesIdentity(item);
    if (seen.has(identity)) throw new K6HttpSummaryError();
    seen.add(identity);
    if (executeRequest(item)) accumulate(totals, item);
  }
  return { requestCount: totals.requestCount, httpFailures: totals.failures, httpSamples: totals.samples,
    httpFailureRatio: totals.samples ? totals.failures! / totals.samples : null,
    httpP95: totals.duration ? distributionPercentile(totals.duration, 95) : null };
}
/** Uses the named native test duration, never an arrival-rate configuration. */
export function k6RequestsPerSecond(count: number | null, durationMs: number | null): number | null {
  if (count === null || durationMs === null || durationMs <= 0) return null;
  const rate = count / (durationMs / 1000);
  return Number.isFinite(rate) ? rate : null;
}
