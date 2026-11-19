import { K6_LIVE_CHECKS } from '@beetle/contracts/k6-live';
import { ruleUnit } from './rule-units.js';
import type { RuleUnit } from './rule-units.js';
import type { LiveMetricSnapshot } from '@beetle/contracts/api';

export type MetricWindowView = Pick<LiveMetricSnapshot, 'series' | 'subset' | 'startTimeMs' | 'endTimeMs'>;
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
  readonly checksRatio: number | null;
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

function gauge(frame: MetricWindowView, metric: string): number | null {
  const row = frame.series.find((s) => s.metric === metric && s.total.kind === 'gauge');
  return row?.total.kind === 'gauge' ? row.total.latest : null;
}

function checksRatio(frame: MetricWindowView): number | null {
  const row = frame.series.find((value) => value.metric === K6_LIVE_CHECKS);
  return row?.total.kind === 'rate' ? row.total.ratio : null;
}

function percentile(values: readonly (number | null)[]): Percentile | null {
  const known = values.filter((v): v is number => v !== null);
  if (!known.length) return null;
  return { value: Math.max(...known), slowest: known.length > 1, fastest: Math.min(...known) };
}

interface Failures {
  readonly numerator: number;
  readonly samples: number;
}
interface RawRow extends EndpointRow {
  readonly failures: Failures | null;
}

/** Planned request labels plus any execute-phase request in the live subset. */
function requestLabels(frame: MetricWindowView, plan: RunPlan): string[] {
  const labels = new Set<string>(plan.requests.map((r) => r.label));
  for (const s of frame.subset.selected) if (s.tags.request && s.tags.phase === 'execute') labels.add(s.tags.request);
  return [...labels];
}

function trendOf(frame: MetricWindowView, label: string): Trend | null {
  const total = frame.series.find((s) => executeRequest(s, 'http_req_duration', label))?.total;
  return total?.kind === 'trend' ? (total as Trend) : null;
}

function failuresOf(frame: MetricWindowView, label: string): { ratio: number | null; counts: Failures | null } {
  const total = frame.series.find((s) => executeRequest(s, 'http_req_failed', label))?.total;
  if (total?.kind !== 'rate') return { ratio: null, counts: null };
  return { ratio: total.ratio, counts: { numerator: total.numerator, samples: total.sampleCount } };
}

/** A selected series without a value had no samples in this window: zero requests. */
function requestCount(trend: Trend | null, live: boolean): number | null {
  if (trend) return trend.count;
  return live ? 0 : null;
}

function percentilesOf(trend: Trend | null): Pick<EndpointRow, 'p50' | 'p95' | 'p99'> {
  if (!trend) return { p50: null, p95: null, p99: null };
  const { p50, p95, p99 } = trend.percentiles;
  return { p50: p50.estimate, p95: p95.estimate, p99: p99.estimate };
}

function endpointRow(frame: MetricWindowView, plan: RunPlan, label: string, seconds: number): RawRow {
  const trend = trendOf(frame, label);
  const failure = failuresOf(frame, label);
  const live = frame.subset.selected.some(
    (s) => s.metric === 'http_req_duration' && s.tags.request === label && !s.tags.assertion,
  );
  const requests = requestCount(trend, live);
  return {
    label,
    request: plan.requests.find((r) => r.label === label) ?? null,
    requests,
    rps: requests === null ? null : requests / seconds,
    share: null,
    ...percentilesOf(trend),
    failed: failure.ratio,
    failures: failure.counts,
    live,
  };
}

/** Pooled failures (sum of numerators over sum of samples), only when every endpoint reports them. */
function pooledFailures(rows: readonly RawRow[]): Failures | null {
  if (!rows.length || rows.some((row) => row.failures === null)) return null;
  return rows.reduce<Failures>(
    (sum, row) => ({
      numerator: sum.numerator + row.failures!.numerator,
      samples: sum.samples + row.failures!.samples,
    }),
    { numerator: 0, samples: 0 },
  );
}

function withShares(rows: readonly RawRow[], total: number | null): EndpointRow[] {
  return rows
    .map((row): EndpointRow => ({
      label: row.label,
      request: row.request,
      requests: row.requests,
      rps: row.rps,
      share: total && row.requests !== null ? row.requests / total : null,
      p50: row.p50,
      p95: row.p95,
      p99: row.p99,
      failed: row.failed,
      live: row.live,
    }))
    .sort((a, b) => (b.p95 ?? -1) - (a.p95 ?? -1));
}

export function liveFigures(frame: MetricWindowView, plan: RunPlan): LiveFigures {
  const windowMs = Math.max(1, frame.endTimeMs - frame.startTimeMs);
  const seconds = windowMs / 1000;
  const rows = requestLabels(frame, plan).map((label) => endpointRow(frame, plan, label, seconds));
  const complete = rows.length > 0 && rows.every((row) => row.requests !== null);
  const total = complete ? rows.reduce((sum, row) => sum + row.requests!, 0) : null;
  const pooled = pooledFailures(rows);
  const endpoints = withShares(rows, total);
  return {
    windowMs,
    rps: total === null ? null : total / seconds,
    p50: percentile(endpoints.map((row) => row.p50)),
    p95: percentile(endpoints.map((row) => row.p95)),
    p99: percentile(endpoints.map((row) => row.p99)),
    failedRatio: pooled && pooled.samples > 0 ? pooled.numerator / pooled.samples : null,
    failedPerSecond: pooled ? pooled.numerator / seconds : null,
    checksRatio: checksRatio(frame),
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
  readonly unit: RuleUnit;
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

const unknown = (rule: PlanRule, unit: RuleReading['unit']): RuleReading => ({
  rule,
  state: 'unknown',
  value: null,
  bound: 'exact',
  unit,
});

function readPercentileRule(rule: PlanRule, figures: LiveFigures): RuleReading {
  const p = figures[rule.stat as 'p50' | 'p95' | 'p99'];
  if (!p || !figures.complete) return unknown(rule, 'ms');
  // The pooled percentile lies between the fastest and slowest endpoint percentile.
  const high = passes(p.value, rule);
  const low = passes(p.fastest, rule);
  const state: RuleState = high !== low ? 'unknown' : high ? 'holding' : 'over';
  return { rule, state, value: p.value, bound: p.slowest ? 'at-most' : 'exact', unit: 'ms' };
}

function readRatioRule(rule: PlanRule, value: number | null): RuleReading {
  if (value === null) return unknown(rule, 'ratio');
  return { rule, state: passes(value, rule) ? 'holding' : 'over', value, bound: 'exact', unit: 'ratio' };
}

/** Latest-window reading of one threshold. The verdict still comes from the sealed result. */
export function readRule(rule: PlanRule, figures: LiveFigures): RuleReading {
  if (rule.metric === 'http_req_duration' && ['p50', 'p95', 'p99'].includes(rule.stat))
    return readPercentileRule(rule, figures);
  if (rule.stat === 'rate' && rule.metric === 'http_req_failed') return readRatioRule(rule, figures.failedRatio);
  if (rule.stat === 'rate' && rule.metric === 'checks') return readRatioRule(rule, figures.checksRatio);
  return unknown(rule, ruleUnit(rule));
}

export function ruleName(rule: PlanRule): string {
  if (rule.metric === 'http_req_duration') return `${rule.stat} latency`;
  if (rule.metric === 'http_req_failed') return 'Failed requests';
  if (rule.metric === 'checks') return 'Checks passing';
  return `${rule.metric} ${rule.stat}`;
}
