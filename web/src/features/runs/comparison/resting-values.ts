import type { RunMetricOverview, RunHistorySummary, RunChartHistory } from '@beetle/contracts/api';
import { k6RequestsPerSecond } from '@beetle/contracts/k6-history';
import type { OverviewRead, ChartRead } from './useComparison.js';
import { matchingRecordedSource } from './recorded-source.js';

export type ComparisonWorkloadMetric = 'requests' | 'p95' | 'failures' | 'vus';
type WholeRun = RunMetricOverview | RunHistorySummary;
const readings = {
  requests: (value: WholeRun) => value.requestsPerSecond,
  p95: (value: WholeRun) =>
    'runId' in value ? (value.httpP95?.estimate ?? null) : (value.latency?.percentiles.p95.estimate ?? null),
  failures: (value: WholeRun) =>
    k6RequestsPerSecond(
      'runId' in value ? value.httpFailures : (value.failure?.numerator ?? null),
      value.testDurationMs,
    ),
};

/** Recorded totals and pooled percentiles must belong to the plotted original. */
export function comparisonRestingValue(
  metric: ComparisonWorkloadMetric,
  overview: OverviewRead | undefined,
  history: ChartRead | undefined,
  summary?: RunHistorySummary | null,
): number | null {
  if (history?.status !== 'loaded' || history.value.reason !== null) return null;
  if (metric === 'vus') return history.value.meanVus;
  const original = recordedOriginal(overview, summary, history.value);
  return original ? readings[metric](original) : null;
}

/** Ready overviews own their nulls; only absent/unavailable overviews permit retained-source fallback. */
function recordedOriginal(
  overview: OverviewRead | undefined,
  summary: RunHistorySummary | null | undefined,
  history: RunChartHistory,
): WholeRun | null {
  if (overview?.status === 'loaded' && overview.value.availability === 'ready')
    return matchingRecordedSource(overview.value, history) ? overview.value : null;
  if (summary?.availability !== 'ready') return null;
  return matchingRecordedSource(summary, history) ? summary : null;
}

const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
/** Do not round a positive recorded mean into a displayed zero or an unbounded digit string. */
export function comparisonNumber(value: number): string {
  return (value > 0 && value < 0.01) || value >= 1e6 ? value.toExponential(2) : number.format(value);
}
