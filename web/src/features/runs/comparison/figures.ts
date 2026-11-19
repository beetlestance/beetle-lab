import type { RunHistorySummary, RunMetricOverview } from '@beetle/contracts/api';
import { comparisonPeak } from './recorded-source.js';
import type { OverviewRead, ChartRead } from './useComparison.js';
export interface ComparisonFigures {
  readonly peakRequestsPerSecond: number | null;
  readonly requestsPerSecond: number | null;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
  readonly failureRatio: number | null;
  readonly checksRatio: number | null;
  readonly droppedIterations: number | null;
  readonly requestCount: number | null;
  readonly testDurationMs: number | null;
}
/** Each figure set comes from one accepted source; no cross-source field backfill. */
export function comparisonFigures(
  summary: RunHistorySummary | null | undefined,
  read: OverviewRead | undefined,
  history?: ChartRead,
): ComparisonFigures | null {
  if (read?.status === 'loaded' && read.value.availability === 'ready')
    return overviewFigures(read.value, comparisonPeak(read, history));
  if (summary?.availability !== 'ready') return null;
  return {
    peakRequestsPerSecond: null,
    requestsPerSecond: summary.requestsPerSecond,
    p50: null,
    p95: summary.httpP95?.estimate ?? null,
    p99: null,
    failureRatio: summary.httpFailureRatio,
    checksRatio: null,
    droppedIterations: null,
    requestCount: summary.requestCount,
    testDurationMs: summary.testDurationMs,
  };
}

function overviewFigures(value: RunMetricOverview, peak: number | null): ComparisonFigures {
  return {
    peakRequestsPerSecond: peak,
    requestsPerSecond: value.requestsPerSecond,
    ...latencyFigures(value),
    failureRatio: value.failure?.ratio ?? null,
    checksRatio: value.checks?.ratio ?? null,
    droppedIterations: value.droppedIterations,
    requestCount: value.requestCount,
    testDurationMs: value.testDurationMs,
  };
}
function latencyFigures(value: RunMetricOverview): Pick<ComparisonFigures, 'p50' | 'p95' | 'p99'> {
  return {
    p50: value.latency?.percentiles.p50.estimate ?? null,
    p95: value.latency?.percentiles.p95.estimate ?? null,
    p99: value.latency?.percentiles.p99.estimate ?? null,
  };
}
