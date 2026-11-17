import type { LiveMetricSnapshot } from '@beetle/contracts/api';
import type { PlanRequest, PlanRule, RunPlan } from './plan.js';

/**
 * Figures for the latest live window. The k6 live subset carries per-request
 * duration (trend) and failure (rate) series, not a pooled latency series, so
 * percentiles across endpoints are never averaged: one endpoint gives the exact
 * value, several give the slowest endpoint, which bounds the pooled percentile
 * from above (and the fastest from below).
 */
type Series = LiveMetricSnapshot['series'][number];
type Trend = Extract<Series['total'], { kind: 'trend' }>;

export interface Percentile {
  readonly value: number;
  /** True when several endpoints were measured: value is the slowest one. */
  readonly slowest: boolean;
  readonly fastest: number;
}
export interface EndpointRow {
  readonly label: string;
  readonly request: PlanRequest | null;
  readonly requests: number | null;
  readonly rps: number | null;
  readonly share: number | null;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
  readonly failed: number | null;
  /** False when the endpoint is in the plan but not in the live subset. */
  readonly live: boolean;
}
export interface LiveFigures {
  readonly windowMs: number;
  /** Null unless every planned endpoint is in the live subset. */
  readonly rps: number | null;
  readonly p50: Percentile | null;
  readonly p95: Percentile | null;
  readonly p99: Percentile | null;
  readonly failedRatio: number | null;
  readonly failedPerSecond: number | null;
  readonly vus: number | null;
  readonly vusMax: number | null;
  readonly endpoints: readonly EndpointRow[];
  readonly excludedSeries: number;
  readonly complete: boolean;
}

const executeRequest = (series: Series, metric: string, label: string) =>
  series.metric === metric &&
  series.scope === 'execute' &&
  series.tags.phase === 'execute' &&
  series.tags.request === label &&
  series.tags.assertion === undefined;

function gauge(frame: LiveMetricSnapshot, metric: string): number | null {
  const row = frame.series.find((s) => s.metric === metric && s.total.kind === 'gauge');
  return row?.total.kind === 'gauge' ? row.total.latest : null;
}

function percentile(values: readonly (number | null)[]): Percentile | null {
  const known = values.filter((v): v is number => v !== null);
  if (!known.length) return null;
  return { value: Math.max(...known), slowest: known.length > 1, fastest: Math.min(...known) };
}

export function liveFigures(frame: LiveMetricSnapshot, plan: RunPlan): LiveFigures {
  const windowMs = Math.max(1, frame.endTimeMs - frame.startTimeMs);
  const seconds = windowMs / 1000;
  const labels = new Set<string>(plan.requests.map((r) => r.label));
  for (const s of frame.subset.selected) if (s.tags.request && s.tags.phase === 'execute') labels.add(s.tags.request);
  const selected = (metric: string, label: string) =>
    frame.subset.selected.some((s) => s.metric === metric && s.tags.request === label && !s.tags.assertion);
  const rows = [...labels].map((label) => {
    const request = plan.requests.find((r) => r.label === label) ?? null;
    const duration = frame.series.find((s) => executeRequest(s, 'http_req_duration', label))?.total;
    const failure = frame.series.find((s) => executeRequest(s, 'http_req_failed', label))?.total;
    const trend = duration?.kind === 'trend' ? (duration as Trend) : null;
    const live = selected('http_req_duration', label);
    // A selected series without a value had no samples in this window: zero requests, no percentiles.
    const requests = trend ? trend.count : live ? 0 : null;
    return {
      label,
      request,
      requests,
      rps: requests === null ? null : requests / seconds,
      share: null as number | null,
      p50: trend?.percentiles.p50.estimate ?? null,
      p95: trend?.percentiles.p95.estimate ?? null,
      p99: trend?.percentiles.p99.estimate ?? null,
      failed: failure?.kind === 'rate' ? failure.ratio : null,
      failures: failure?.kind === 'rate' ? { numerator: failure.numerator, samples: failure.sampleCount } : null,
      live,
    };
  });
  const complete = rows.length > 0 && rows.every((row) => row.requests !== null);
  const total = complete ? rows.reduce((sum, row) => sum + row.requests!, 0) : null;
  const failures = rows.map((row) => row.failures);
  const pooled = failures.every((f) => f !== null) && failures.length > 0;
  const numerator = pooled ? failures.reduce((sum, f) => sum + f!.numerator, 0) : 0;
  const samples = pooled ? failures.reduce((sum, f) => sum + f!.samples, 0) : 0;
  const endpoints: EndpointRow[] = rows
    .map(({ failures: _failures, ...row }) => ({
      ...row,
      share: total && row.requests !== null ? row.requests / total : null,
    }))
    .sort((a, b) => (b.p95 ?? -1) - (a.p95 ?? -1));
  return {
    windowMs,
    rps: total === null ? null : total / seconds,
    p50: percentile(endpoints.map((row) => row.p50)),
    p95: percentile(endpoints.map((row) => row.p95)),
    p99: percentile(endpoints.map((row) => row.p99)),
    failedRatio: pooled && samples > 0 ? numerator / samples : null,
    failedPerSecond: pooled ? numerator / seconds : null,
    vus: gauge(frame, 'vus'),
    vusMax: gauge(frame, 'vus_max'),
    endpoints,
    excludedSeries: frame.subset.excludedSeries,
    complete,
  };
}

export type RuleState = 'holding' | 'over' | 'unknown';
export interface RuleReading {
  readonly rule: PlanRule;
  readonly state: RuleState;
  /** Display value for the latest window, or null when the live view cannot measure it. */
  readonly value: number | null;
  readonly bound: 'exact' | 'at-most';
  readonly unit: 'ms' | 'ratio';
}

const passes = (value: number, rule: PlanRule) => {
  switch (rule.operator) {
    case '<':
      return value < rule.value;
    case '<=':
      return value <= rule.value;
    case '>':
      return value > rule.value;
    case '>=':
      return value >= rule.value;
  }
};

/** Latest-window reading of one threshold. The verdict still comes from the sealed result. */
export function readRule(rule: PlanRule, figures: LiveFigures): RuleReading {
  if (rule.metric === 'http_req_duration' && ['p50', 'p95', 'p99'].includes(rule.stat)) {
    const p = figures[rule.stat as 'p50' | 'p95' | 'p99'];
    if (!p || !figures.complete) return { rule, state: 'unknown', value: null, bound: 'exact', unit: 'ms' };
    // The pooled percentile lies between the fastest and slowest endpoint percentile.
    const high = passes(p.value, rule);
    const low = passes(p.fastest, rule);
    const state: RuleState = high === low ? (high ? 'holding' : 'over') : 'unknown';
    return { rule, state, value: p.value, bound: p.slowest ? 'at-most' : 'exact', unit: 'ms' };
  }
  if (rule.metric === 'http_req_failed' && rule.stat === 'rate') {
    const value = figures.failedRatio;
    if (value === null) return { rule, state: 'unknown', value: null, bound: 'exact', unit: 'ratio' };
    return { rule, state: passes(value, rule) ? 'holding' : 'over', value, bound: 'exact', unit: 'ratio' };
  }
  return { rule, state: 'unknown', value: null, bound: 'exact', unit: 'ms' };
}

export function ruleName(rule: PlanRule): string {
  if (rule.metric === 'http_req_duration') return `${rule.stat} latency`;
  if (rule.metric === 'http_req_failed') return 'Failed requests';
  if (rule.metric === 'checks') return 'Checks passing';
  return `${rule.metric} ${rule.stat}`;
}
