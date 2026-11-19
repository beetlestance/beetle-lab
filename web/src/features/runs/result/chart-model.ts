import type { RunPlan } from '../live/plan.js';
import type { RunChartHistory, RunMetricOverview } from '@beetle/contracts/api';
import type { MetricChartPoint } from '../charts/types.js';
import type { ChartTick } from '../live/LiveChart.js';
import { clock } from '../live/format.js';
export interface RecordedPlot {
  readonly points: readonly MetricChartPoint[];
  readonly domain: readonly [number, number];
  readonly ticks: readonly ChartTick[];
  readonly lastWindowBeforePlanEnd: number | null;
}
export const sourceClock = (time: number) => {
  if (time !== 0 && Math.abs(time) < 1000)
    return `${(time / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 })} s`;
  return time < 0 ? `−${clock(-time)}` : clock(time);
};
/** Source UTC relative to the recorded native measurement marker, never browser time. */
export function recordedPlot(value: RunChartHistory, plannedDurationMs: number | null = null): RecordedPlot | null {
  if (value.reason !== null || !value.source) return null;
  const origin = value.source.measurementSourceTimeMs;
  const points = value.points.map((point) => ({
    t: point.endTimeMs - origin,
    gapBefore: point.gapBefore,
    rps: point.requestCount,
    p50: point.httpP50?.estimate ?? null,
    p95: point.httpP95?.estimate ?? null,
    p99: point.httpP99?.estimate ?? null,
    failedPerSecond: point.httpFailures,
    vus: point.vus,
    vusMax: point.vusMax,
  }));
  const first = Math.min(0, value.points.length ? value.points[0]!.startTimeMs - origin : 0);
  const last = Math.max(first + 1000, points.at(-1)?.t ?? 0);
  const end = extendToPlan(last, plannedDurationMs);
  const ticks = Array.from({ length: 5 }, (_, index) => {
    const at = first + ((end - first) * index) / 4;
    return { at, label: sourceClock(at) };
  });
  return { points, domain: [first, end], ticks, lastWindowBeforePlanEnd: end > last ? last : null };
}
function extendToPlan(last: number, planned: number | null): number {
  return planned !== null && Number.isFinite(planned) ? Math.max(last, planned) : last;
}
/** Never attach a peak from another manifest or numeric original to the summary. */
export function sameChartSource(overview: Pick<RunMetricOverview, 'source'>, history: RunChartHistory): boolean {
  const a = overview.source,
    b = history.source;
  return (
    !!a &&
    !!b &&
    a.manifestDigest === b.manifestDigest &&
    a.numericArtifactId.toLowerCase() === b.numericArtifactId.toLowerCase() &&
    a.numericSha256 === b.numericSha256 &&
    a.measurementSourceTimeMs === b.measurementSourceTimeMs
  );
}

/** Only named saved-plan stages; clip them to recorded source time. */
export function recordedBands(plan: RunPlan, domain: readonly [number, number]) {
  const first = plan.stages.length > 2 ? plan.stages[0] : undefined;
  const stages = plan.stages.filter((stage) => stage.drain || stage === first);
  return stages
    .map((stage) => ({
      from: Math.max(domain[0], stage.startMs),
      to: Math.min(domain[1], stage.startMs + stage.durationMs),
    }))
    .filter((band) => band.to > band.from);
}
