import {
  K6HttpSummaryError,
  isK6ExecuteRequest,
  summarizeK6HttpTotals,
  k6RequestsPerSecond,
} from '@beetle/contracts/k6-history';
import { DistributionError, mergeDistributions, projectMetricValue } from '@beetle/contracts/metrics';
import type { NumericTotal, SeriesTotal } from '@beetle/contracts/metrics';
import type { RunMetricOverview, RunMetricEndpoint, RunMetricTrend } from '@beetle/contracts/api';
import type { RunKey } from '../../ports/runs.js';
import type { Publication } from './archive.js';
import { historyProjection } from './history.js';
import { fail } from './values.js';

function add(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) return fail();
  return value;
}
function latency(totals: readonly SeriesTotal[]): RunMetricTrend | null {
  let merged: Extract<NumericTotal, { kind: 'trend' }> | null = null;
  for (const item of totals) {
    if (!isK6ExecuteRequest(item) || item.metric !== 'http_req_duration') continue;
    const t = item.total;
    if (t.kind !== 'trend') return fail();
    if (!merged) {
      merged = t;
      continue;
    }
    const sum: number = merged.sum + t.sum;
    if (!Number.isFinite(sum)) return fail();
    const count = add(merged.count, t.count);
    merged = {
      kind: 'trend',
      count,
      sum,
      min: Math.min(merged.min, t.min),
      max: Math.max(merged.max, t.max),
      mean: sum / count,
      distribution: mergeDistributions(merged.distribution, t.distribution),
    };
  }
  return merged ? (projectMetricValue(merged) as RunMetricTrend) : null;
}
export function httpTraffic(totals: readonly SeriesTotal[], durationMs: number | null) {
  const summary = summarizeK6HttpTotals(totals);
  const failure =
    summary.httpSamples === null || summary.httpFailures === null
      ? null
      : {
          kind: 'rate' as const,
          numerator: summary.httpFailures,
          sampleCount: summary.httpSamples,
          ratio: summary.httpFailureRatio,
        };
  return {
    requestCount: summary.requestCount,
    requestsPerSecond: k6RequestsPerSecond(summary.requestCount, durationMs),
    failure,
    latency: latency(totals),
  };
}
/** All native assertion counters, excluding prepare. Missing failure counters remain unknown. */
function checks(totals: readonly SeriesTotal[]): RunMetricOverview['checks'] {
  const assertions = new Map<string, { total?: number; failures?: number }>();
  for (const item of totals) {
    if (!assertionCounter(item)) continue;
    if (item.total.kind !== 'counter') return fail();
    const row = assertions.get(item.tags.assertion!) ?? {};
    const key = item.metric === 'beetle_assertions' ? 'total' : 'failures';
    if (row[key] !== undefined) return fail();
    row[key] = item.total.sum;
    assertions.set(item.tags.assertion!, row);
  }
  return assertionCounts(assertions);
}
function assertionCounts(assertions: Map<string, { total?: number; failures?: number }>): RunMetricOverview['checks'] {
  if (!assertions.size) return null;
  let total = 0;
  let failures = 0;
  for (const row of assertions.values()) {
    if (row.total === undefined || row.failures === undefined) return null;
    if (row.failures > row.total) return fail();
    total = add(total, row.total);
    failures = add(failures, row.failures);
  }
  return { total, passed: total - failures, ratio: total ? (total - failures) / total : null };
}
function dropped(totals: readonly SeriesTotal[]): number | null {
  const candidates = totals.filter(
    (item) => item.metric === 'dropped_iterations' && item.scope === 'execute' && Object.keys(item.tags).length === 0,
  );
  if (candidates.length > 1) return fail();
  const value = candidates[0]?.total;
  if (value && value.kind !== 'counter') return fail();
  return value?.sum ?? null;
}
/** One compact projection of the already verified original; never reads metric-window data. */
function projectOverview(key: RunKey & { attemptId: string }, p: Publication): RunMetricOverview {
  const history = historyProjection(p);
  const totals = p.archive?.numeric.totals;
  const scenarioStartedAtMs = p.archive?.numeric.scenarioStartedAtMs;
  const durationMs = p.archive?.numeric.testDurationMs ?? null;
  const base = {
    id: key.id,
    scope: key.scope,
    attemptId: key.attemptId,
    availability: history.availability,
    source: history.source,
    ...(scenarioStartedAtMs === undefined ? {} : { scenarioStartedAtMs }),
    testDurationMs: durationMs,
    requestCount: null,
    requestsPerSecond: null,
    failure: null,
    latency: null,
    checks: null,
    droppedIterations: null,
    endpoints: [],
    omittedEndpoints: 0,
  };
  if (!totals) return base;
  const groups = new Map<string, SeriesTotal[]>();
  for (const item of totals) {
    if (!isK6ExecuteRequest(item)) continue;
    const label = item.tags.request!;
    const rows = groups.get(label) ?? [];
    rows.push(item);
    groups.set(label, rows);
  }
  const labels = [...groups.keys()].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const endpoints: RunMetricEndpoint[] = labels
    .slice(0, 64)
    .map((request) => ({ request, ...httpTraffic(groups.get(request)!, durationMs) }));
  return {
    ...base,
    ...httpTraffic(totals, durationMs),
    checks: checks(totals),
    droppedIterations: dropped(totals),
    endpoints,
    omittedEndpoints: Math.max(0, labels.length - endpoints.length),
  };
}

export function metricOverview(key: RunKey & { attemptId: string }, publication: Publication): RunMetricOverview {
  try {
    return projectOverview(key, publication);
  } catch (error) {
    if (error instanceof DistributionError || error instanceof K6HttpSummaryError) return fail();
    throw error;
  }
}

function assertionCounter(item: SeriesTotal): boolean {
  return (
    item.scope === 'execute' &&
    item.tags.phase === 'execute' &&
    item.tags.request === undefined &&
    item.tags.assertion !== undefined &&
    ['beetle_assertions', 'beetle_assertion_failures'].includes(item.metric)
  );
}
