import type { RunHistorySummary, RunMetricOverview } from '@beetle/contracts/api';
import type { OverviewRead } from './useComparison.js';
export interface ComparisonFigures {
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
): ComparisonFigures | null {
  if (read?.status === 'loaded' && read.value.availability === 'ready') return overviewFigures(read.value);
  if (summary?.availability !== 'ready') return null;
  return {
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

function overviewFigures(value: RunMetricOverview): ComparisonFigures {
  return {
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
