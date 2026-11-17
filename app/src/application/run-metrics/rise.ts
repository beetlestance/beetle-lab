import { distributionPercentile, mergeDistributions } from '@beetle/contracts/metrics';
import type { DurationDistribution, MetricWindow } from '@beetle/contracts/metrics';
import { isK6ExecuteRequest } from '@beetle/contracts/k6-history';
import type { RunLatencyAttribution } from '@beetle/contracts/api';
import { fail } from './values.js';

/** Fixed thresholds of the documented p95-rise definition (results.md "Latency attribution"). */
export const RISE = Object.freeze({
  minSamples: 20,
  baselineWindows: 10,
  riseWindows: 5,
  factor: 1.5,
  endpointBaselineWindows: 3,
});
type Rise = NonNullable<RunLatencyAttribution['rise']>;
export type RiseReason = 'too_few_windows' | 'no_rise';
interface Endpoint {
  readonly request: string;
  readonly count: number;
  readonly p95: number | null;
}
/** One 1 s window reduced to merged HTTP p95 plus per-request p95 (ms). */
export interface RisePoint {
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly count: number;
  readonly p95: number | null;
  readonly endpoints: readonly Endpoint[];
}
function p95(distribution: DurationDistribution): number | null {
  return distributionPercentile(distribution, 95)?.estimate ?? null;
}
export function risePoint(window: MetricWindow): RisePoint {
  let merged: DurationDistribution | null = null;
  const endpoints: Endpoint[] = [];
  for (const series of window.series) {
    if (series.metric !== 'http_req_duration' || !isK6ExecuteRequest(series)) continue;
    if (series.total.kind !== 'trend') return fail();
    const distribution = series.total.distribution;
    merged = merged ? mergeDistributions(merged, distribution) : distribution;
    endpoints.push({ request: series.tags.request!, count: distribution.count, p95: p95(distribution) });
  }
  return {
    startTimeMs: window.startTimeMs,
    endTimeMs: window.endTimeMs,
    count: merged?.count ?? 0,
    p95: merged ? p95(merged) : null,
    endpoints,
  };
}
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
const measured = (point: RisePoint): point is RisePoint & { p95: number } =>
  point.p95 !== null && point.count >= RISE.minSamples;
function elevated(point: RisePoint, baseline: number): boolean {
  return measured(point) && point.p95 > baseline && point.p95 >= RISE.factor * baseline;
}
/** Longest run of time-adjacent elevated windows; earliest wins a tie. */
function episode(points: readonly RisePoint[], baseline: number): readonly RisePoint[] {
  let best = { start: 0, length: 0 };
  let start = 0;
  let length = 0;
  points.forEach((point, i) => {
    if (!elevated(point, baseline)) length = 0;
    else if (length > 0 && points[i - 1]!.endTimeMs === point.startTimeMs) length++;
    else [start, length] = [i, 1];
    if (length > best.length) best = { start, length };
  });
  return points.slice(best.start, best.start + best.length);
}
function endpointBaselines(phase: readonly RisePoint[]): Map<string, number> {
  const values = new Map<string, number[]>();
  for (const point of phase)
    for (const e of point.endpoints) {
      if (e.p95 === null) continue;
      const list = values.get(e.request) ?? [];
      list.push(e.p95);
      values.set(e.request, list);
    }
  const baselines = new Map<string, number>();
  for (const [request, list] of values)
    if (list.length >= RISE.endpointBaselineWindows) baselines.set(request, median(list));
  return baselines;
}
/** Excess = sum of count x (p95 - own baseline)+; named only when one request holds more than half. */
function excesses(windows: readonly RisePoint[], baselines: Map<string, number>) {
  const excess = new Map<string, number>();
  const peaks = new Map<string, number>();
  for (const point of windows)
    for (const e of point.endpoints) {
      if (e.p95 === null) continue;
      const own = baselines.get(e.request);
      if (own === undefined) return null;
      excess.set(e.request, (excess.get(e.request) ?? 0) + e.count * Math.max(0, e.p95 - own));
      peaks.set(e.request, Math.max(peaks.get(e.request) ?? 0, e.p95));
    }
  return { excess, peaks };
}
function attribute(windows: readonly RisePoint[], baselines: Map<string, number>): Rise['endpoint'] {
  const measured = excesses(windows, baselines);
  if (!measured) return null;
  const { excess, peaks } = measured;
  const total = [...excess.values()].reduce((sum, value) => sum + value, 0);
  if (!(total > 0) || !Number.isFinite(total)) return null;
  for (const [request, value] of excess)
    if (value / total > 0.5) return { request, share: value / total, peakP95Ms: peaks.get(request)! };
  return null;
}
export function riseOf(points: readonly RisePoint[]): { rise: Rise | null; reason: RiseReason | null } {
  const phase = points.slice(0, Math.floor(points.length / 3)).filter(measured);
  if (phase.length < RISE.baselineWindows) return { rise: null, reason: 'too_few_windows' };
  const baseline = median(phase.map((point) => point.p95));
  const windows = episode(points, baseline);
  if (windows.length < RISE.riseWindows) return { rise: null, reason: 'no_rise' };
  return {
    reason: null,
    rise: {
      startTimeMs: windows[0]!.startTimeMs,
      endTimeMs: windows.at(-1)!.endTimeMs,
      windows: windows.length,
      baselineP95Ms: baseline,
      peakP95Ms: Math.max(...windows.map((point) => point.p95!)),
      endpoint: attribute(windows, endpointBaselines(phase)),
    },
  };
}
