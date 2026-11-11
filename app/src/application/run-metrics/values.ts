import { MetricReadError } from '../../ports/run-metrics.js';
import { captureMetricSeries, metricSeriesIdentity, distributionPercentile } from '@beetle/contracts/metrics';
import type { NumericTotal, SeriesTotal } from '@beetle/contracts/metrics';
import type { RunMetricSeries, RunMetricValue, RunMetricCoverage } from '@beetle/contracts/api';
export function fail(): never { throw new MetricReadError('unavailable'); }
export function fields(v: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== keys.length
    || keys.some(k => !Object.hasOwn(v, k))) return fail(); return v as Record<string, unknown>;
}
export function safe(v: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > max || Object.is(v, -0)) return fail(); return v;
}
export function metricValue(total: NumericTotal): RunMetricValue {
  if (total.kind === 'rate') return {...total, ratio: total.sampleCount ? total.numerator / total.sampleCount : null};
  if (total.kind !== 'trend') return {...total};
  const {distribution, ...value} = total;
  const p = (n: 50 | 90 | 95 | 99) => distributionPercentile(distribution, n) ?? fail();
  return {...value, percentiles: {p50: p(50), p90: p(90), p95: p(95), p99: p(99)}};
}
export function descriptor(value: SeriesTotal, ordinal: number): RunMetricSeries {
  if (value.scope !== 'execute' && value.scope !== 'engine') return fail();
  const unit = value.kind === 'trend' ? 'ms' : value.kind === 'rate' ? 'ratio'
    : ['data_received', 'data_sent'].includes(value.metric) ? 'bytes' : 'count';
  return {ordinal, metric: value.metric, kind: value.kind, scope: value.scope, tags: {...value.tags}, unit, total: metricValue(value.total)};
}
export interface NumericEvidence {
  readonly totals: readonly SeriesTotal[]; readonly coverage: RunMetricCoverage; readonly sourceTimeMs: number;
  readonly windows: number; readonly bytes: number; readonly dataArtifactId: string; readonly indexArtifactId: string;
}
function numericScope(value: unknown, scope: unknown): void {
  const s = fields(value, ['organizationId', 'workspaceId', 'attemptId', 'generation']);
  if (Object.keys(s).some(k => s[k] !== (scope as Record<string, unknown>)[k])) return fail();
}
function coverageValue(value: unknown): RunMetricCoverage {
  const c = fields(value, ['complete', 'latePoints', 'markerDelayDroppedBuckets']);
  const latePoints = safe(c.latePoints); const markerDelayDroppedBuckets = safe(c.markerDelayDroppedBuckets);
  if (typeof c.complete !== 'boolean' || c.complete !== (latePoints === 0 && markerDelayDroppedBuckets === 0)) return fail();
  return {complete: c.complete, latePoints, markerDelayDroppedBuckets};
}
function snapshot(value: unknown) {
  const m = fields(value, ['totals', 'totalsComplete', 'measurement', 'windowCoverage', 'quantiles']);
  const measurement = fields(m.measurement, ['complete', 'sourceTimeMs']);
  if (m.totalsComplete !== true || measurement.complete !== true || m.quantiles !== 'histogram-estimate'
    || !Array.isArray(m.totals) || m.totals.length > 4096) return fail();
  const totals = m.totals.map(captureSeries);
  if (new Set(totals.map(metricSeriesIdentity)).size !== totals.length) return fail();
  return {totals, coverage: coverageValue(m.windowCoverage), sourceTimeMs: safe(measurement.sourceTimeMs, 8640000000000000)};
}
export function captureNumeric(input: unknown, scope: unknown): NumericEvidence | null {
  if (!knownVersion(input, 3)) return null;
  const v = fields(input, ['version', 'scope', 'metrics', 'diagnostics', 'buildUsage', 'windowsRetained', 'history', 'quantiles']);
  numericScope(v.scope, scope);
  if (v.windowsRetained !== true || v.quantiles !== 'histogram-estimate') return fail();
  const h = fields(v.history, ['windows', 'bytes', 'dataArtifactId', 'indexArtifactId']);
  if (typeof h.dataArtifactId !== 'string' || typeof h.indexArtifactId !== 'string') return fail();
  return {...snapshot(v.metrics), windows: safe(h.windows, 65536), bytes: safe(h.bytes, 268435456),
    dataArtifactId: h.dataArtifactId, indexArtifactId: h.indexArtifactId};
}
export function knownVersion(value: unknown, current: number): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, 'version')) return fail();
  const version = safe((value as {version: unknown}).version);
  if (version < 1) return fail(); return version === current;
}
function captureSeries(value: unknown): SeriesTotal {
  try {return captureMetricSeries(value);} catch {return fail();}
}
