import { MetricReadError } from '../../ports/run-metrics.js';
import {
  captureMetricSeries,
  metricSeriesIdentity,
  projectMetricValue,
  projectMetricSeries,
} from '@beetle/contracts/metrics';
import type { NumericTotal, SeriesTotal } from '@beetle/contracts/metrics';
import { captureHttpP95Preview } from '@beetle/contracts/api';
import type { RunHistorySummary, RunMetricSeries, RunMetricValue, RunMetricCoverage } from '@beetle/contracts/api';
export function fail(): never {
  throw new MetricReadError('unavailable');
}
export function fields(v: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(v, k))
  )
    return fail();
  return v as Record<string, unknown>;
}
export function safe(v: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > max || Object.is(v, -0)) return fail();
  return v;
}
export function metricValue(total: NumericTotal): RunMetricValue {
  try {
    return projectMetricValue(total);
  } catch {
    return fail();
  }
}
export function descriptor(value: SeriesTotal, ordinal: number): RunMetricSeries {
  try {
    return projectMetricSeries(value, ordinal);
  } catch {
    return fail();
  }
}
export interface NumericEvidence {
  readonly version: 3 | 4 | 5;
  readonly httpP95Preview?: RunHistorySummary['httpP95Preview'];
  readonly testDurationMs: number | null;
  readonly totals: readonly SeriesTotal[];
  readonly coverage: RunMetricCoverage;
  readonly sourceTimeMs: number;
  readonly windows: number;
  readonly bytes: number;
  readonly dataArtifactId: string;
  readonly indexArtifactId: string;
}
function numericScope(value: unknown, scope: unknown): void {
  const s = fields(value, ['organizationId', 'workspaceId', 'attemptId', 'generation']);
  if (Object.keys(s).some((k) => s[k] !== (scope as Record<string, unknown>)[k])) return fail();
}
function coverageValue(value: unknown): RunMetricCoverage {
  const c = fields(value, ['complete', 'latePoints', 'markerDelayDroppedBuckets']);
  const latePoints = safe(c.latePoints);
  const markerDelayDroppedBuckets = safe(c.markerDelayDroppedBuckets);
  if (typeof c.complete !== 'boolean' || c.complete !== (latePoints === 0 && markerDelayDroppedBuckets === 0))
    return fail();
  return { complete: c.complete, latePoints, markerDelayDroppedBuckets };
}
function snapshot(value: unknown) {
  const m = fields(value, ['totals', 'totalsComplete', 'measurement', 'windowCoverage', 'quantiles']);
  const measurement = fields(m.measurement, ['complete', 'sourceTimeMs']);
  if (
    m.totalsComplete !== true ||
    measurement.complete !== true ||
    m.quantiles !== 'histogram-estimate' ||
    !Array.isArray(m.totals) ||
    m.totals.length > 4096
  )
    return fail();
  const totals = m.totals.map(captureSeries);
  if (new Set(totals.map(metricSeriesIdentity)).size !== totals.length) return fail();
  return {
    totals,
    coverage: coverageValue(m.windowCoverage),
    sourceTimeMs: safe(measurement.sourceTimeMs, 8640000000000000),
  };
}
export function captureNumeric(input: unknown, scope: unknown): NumericEvidence | null {
  const version = artifactVersion(input);
  if (version !== 3 && version !== 4 && version !== 5) return null;
  const keys = ['version', 'scope', 'metrics', 'diagnostics', 'buildUsage', 'windowsRetained', 'history', 'quantiles'];
  if (version >= 4) keys.push('timing');
  if (version === 5) keys.push('httpP95Preview');
  const v = fields(input, keys);
  numericScope(v.scope, scope);
  if (v.windowsRetained !== true || v.quantiles !== 'histogram-estimate') return fail();
  return {
    ...snapshot(v.metrics),
    ...archiveMetadata(v.history),
    version,
    testDurationMs: version >= 4 ? testDuration(v.timing) : null,
    ...(version === 5 ? { httpP95Preview: numericPreview(v.httpP95Preview) } : {}),
  };
}
function archiveMetadata(input: unknown) {
  const h = fields(input, ['windows', 'bytes', 'dataArtifactId', 'indexArtifactId']);
  if (typeof h.dataArtifactId !== 'string' || typeof h.indexArtifactId !== 'string') return fail();
  return {
    windows: safe(h.windows, 65536),
    bytes: safe(h.bytes, 268435456),
    dataArtifactId: h.dataArtifactId,
    indexArtifactId: h.indexArtifactId,
  };
}
function numericPreview(input: unknown) {
  try {
    return captureHttpP95Preview(input);
  } catch {
    return fail();
  }
}
function testDuration(input: unknown): number | null {
  const value = fields(input, ['testRunDurationMs']).testRunDurationMs;
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fail();
  return value;
}
export function knownVersion(value: unknown, current: number): boolean {
  return artifactVersion(value) === current;
}
function artifactVersion(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, 'version')) return fail();
  const version = safe((value as { version: unknown }).version);
  if (version < 1) return fail();
  return version;
}
function captureSeries(value: unknown): SeriesTotal {
  try {
    return captureMetricSeries(value);
  } catch {
    return fail();
  }
}
