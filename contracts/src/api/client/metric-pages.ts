import type { RunMetricSeriesPage, RunMetricSamplesPage, WorkspaceScope } from '../generated/types.js';
import type { MetricPosition, SamplesPosition } from './metric-cursors.js';
import { captureRunMetricSeriesCursor, captureRunMetricSamplesCursor } from './metric-cursors.js';
import { metricDescriptorMatches, metricValueMatches } from './metric-values.js';
export interface Query { id: string; scope: WorkspaceScope; attemptId: string; limit: number; cursor?: string;
  seriesOrdinal?: number; fromTimeMs?: number; toTimeMs?: number }
type Page = RunMetricSeriesPage | RunMetricSamplesPage;
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
export function identity(p: Page, q: Query): boolean {
  return same(p.id, q.id) && same(p.attemptId, q.attemptId) && p.generation === 1
    && same(p.scope.organizationId, q.scope.organizationId) && same(p.scope.workspaceId, q.scope.workspaceId)
    && Number.isSafeInteger(q.limit) && q.limit >= 1 && q.limit <= 100 && p.items.length <= q.limit;
}
export function bound(p: MetricPosition, page: Page): boolean {
  return same(p.organizationId, page.scope.organizationId) && same(p.workspaceId, page.scope.workspaceId)
    && same(p.runId, page.id) && same(p.attemptId, page.attemptId) && p.manifestDigest === page.manifestDigest;
}
export function unavailable(p: RunMetricSeriesPage, cursor: unknown): boolean {
  return !cursor && p.items.length === 0 && p.nextCursor === null && p.windows === 0
    && p.totalSeries === 0 && p.measurementSourceTimeMs === null && p.coverage === null && unavailableManifest(p);
}
function unavailableManifest(p: RunMetricSeriesPage): boolean {
  return p.availability === 'unavailable' ? p.manifestDigest !== null && p.reason !== null : p.manifestDigest === null && p.reason === null;
}
export function ready(p: RunMetricSeriesPage, first: number): boolean {
  if (p.manifestDigest === null || p.reason !== null || p.measurementSourceTimeMs === null || p.coverage === null) return false;
  const end = first + p.items.length;
  if (end > p.totalSeries || !p.items.every((s, i) => s.ordinal === first + i && metricDescriptorMatches(s))) return false;
  return seriesNext(p, end);
}
function seriesNext(p: RunMetricSeriesPage, end: number): boolean {
  if (p.nextCursor === null) return end === p.totalSeries;
  const next = captureRunMetricSeriesCursor(p.nextCursor);
  return p.items.length > 0 && end < p.totalSeries && bound(next, p) && next.nextOrdinal === end;
}
export function sampleSelection(p: RunMetricSamplesPage, q: Query): boolean {
  return metricDescriptorMatches(p.series) && p.series.ordinal === q.seriesOrdinal
    && p.fromTimeMs === (q.fromTimeMs ?? 0) && p.toTimeMs === (q.toTimeMs ?? 8640000000000000)
    && p.fromTimeMs < p.toTimeMs && p.examined <= q.limit && p.items.length <= p.examined;
}
export function selection(c: Pick<SamplesPosition, 'seriesOrdinal' | 'fromTimeMs' | 'toTimeMs'>, p: RunMetricSamplesPage): boolean {
  return c.seriesOrdinal === p.series.ordinal && c.fromTimeMs === p.fromTimeMs && c.toTimeMs === p.toTimeMs;
}
export function sampleCoverage(p: RunMetricSamplesPage): boolean {
  if (!p.examined) return emptySamples(p);
  return p.firstWindow >= 1 && p.firstWindow <= p.beforeWindow && p.beforeWindow - p.firstWindow + 1 >= p.examined
    && p.span !== null && p.span.startTimeMs < p.span.endTimeMs && points(p) && sampleNext(p);
}
function sampleNext(p: RunMetricSamplesPage): boolean {
  if (p.nextCursor === null) return true;
  const next = captureRunMetricSamplesCursor(p.nextCursor);
  return bound(next, p) && selection(next, p) && next.beforeWindow === p.firstWindow - 1 && next.beforeWindow < p.beforeWindow;
}
function pointBound(point: RunMetricSamplesPage['items'][number], p: RunMetricSamplesPage): boolean {
  return point.windowOrdinal >= p.firstWindow && point.windowOrdinal <= p.beforeWindow
    && point.endTimeMs - point.startTimeMs === 1000 && point.endTimeMs > p.fromTimeMs && point.startTimeMs < p.toTimeMs
    && point.startTimeMs >= p.span!.startTimeMs && point.endTimeMs <= p.span!.endTimeMs;
}
function points(p: RunMetricSamplesPage): boolean {
  return p.items.every((point, i) => pointBound(point, p) && point.value.kind === p.series.kind && metricValueMatches(point.value)
    && (i === 0 || (point.windowOrdinal > p.items[i - 1]!.windowOrdinal && point.startTimeMs >= p.items[i - 1]!.endTimeMs)));
}
function emptySamples(p: RunMetricSamplesPage): boolean {
  return p.firstWindow === 0 && p.span === null && p.items.length === 0 && p.nextCursor === null;
}
export function samplePosition(p: RunMetricSamplesPage, q: Query): boolean {
  const start = q.cursor === undefined ? null : captureRunMetricSamplesCursor(q.cursor);
  if (start && (!selection(start, p) || !bound(start, p))) return false;
  return p.beforeWindow === (start?.beforeWindow ?? p.windows) && p.beforeWindow <= p.windows;
}
