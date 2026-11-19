import type { Artifact } from '@beetle/contracts';
import type { RunComparisonItem, RunChartHistory } from '@beetle/contracts/api';
import { targetReading, targetUnitProjection, projectTargetReading } from '@beetle/contracts/target-runtime';
import type { TargetRuntimeReport, TargetMetricName, TargetUnit } from '@beetle/contracts/target-runtime';
import type { ChartSeries, ChartTick } from '../live/LiveChart.js';
import { recordedTargetPlot, targetClock } from '../result/target-model.js';
import type { ChartRead, ComparisonHistories } from './useComparison.js';
import type { ComparisonTargetRead, ComparisonTargets } from './target-read.js';
import { comparisonRunLabels } from './run-labels.js';
const tones = ['ink', 'amber', 'violet', 'info'] as const;
const definitions: readonly { id: string; title: string; keys: readonly TargetMetricName[]; unit: TargetUnit }[] = [
  { id: 'heap', title: 'Target heap', keys: ['usedHeapSize', 'heapAlloc', 'heapInuse'], unit: 'megabytes' },
  { id: 'cpu', title: 'Target process CPU', keys: ['cpuPercent'], unit: 'percent' },
  { id: 'loop', title: 'Target event-loop delay, p99', keys: ['eventLoopDelay.p99'], unit: 'milliseconds' },
  { id: 'activity', title: 'Target activity', keys: ['activeHandles', 'goroutines'], unit: 'count' },
];
interface Source {
  id: string;
  label: string;
  tone: ChartSeries['tone'];
  report: TargetRuntimeReport;
  plot: ReturnType<typeof recordedTargetPlot>;
}
export interface TargetComparisonCard {
  id: string;
  title: string;
  metric: TargetMetricName | null;
  unit: string;
  series: readonly ChartSeries[];
  domain: readonly [number, number];
  ticks: readonly ChartTick[];
}
/** An overlay needs the native marker from the exact numeric artifact in this sealed result. */
export function comparisonTargetSources(
  items: readonly RunComparisonItem[],
  targets: ComparisonTargets | undefined,
  histories: ComparisonHistories | undefined,
) {
  const labels = comparisonRunLabels(items.map((i) => i.run.id));
  const sources: Source[] = [];
  for (const [index, item] of items.entries()) {
    const id = item.run.id.toLowerCase();
    const read = targets?.get(id),
      history = histories?.get(id);
    const source = alignedSource(read, history);
    if (!source) continue;
    sources.push({ id, label: `${labels.get(id)}${index === 0 ? ' (baseline)' : ''}`, tone: tones[index]!, ...source });
  }
  return sources;
}
function alignedSource(read: ComparisonTargetRead | undefined, history: ChartRead | undefined) {
  if (read?.status !== 'ready' || !read.numeric || history?.status !== 'loaded' || history.value.reason !== null)
    return null;
  const numeric = history.value.source;
  if (!numeric || !matchingNumeric(numeric, read.numeric)) return null;
  const plot = recordedTargetPlot(read.report, numeric.measurementSourceTimeMs);
  return usableTimeline(plot) ? { report: read.report, plot } : null;
}
function matchingNumeric(source: NonNullable<RunChartHistory['source']>, artifact: Artifact): boolean {
  return (
    source.numericArtifactId.toLowerCase() === artifact.artifactId.toLowerCase() &&
    source.numericSha256 === artifact.sha256
  );
}
function usableTimeline(plot: ReturnType<typeof recordedTargetPlot>): boolean {
  return (
    plot.chronologySafe &&
    plot.nativeTime &&
    plot.omittedTimestamps === 0 &&
    plot.points.every((point, index) => index === 0 || point.t > plot.points[index - 1]!.t)
  );
}
/** Only the same declared metric is compared; raw units and different runtime keys never mix. */
export function comparisonTargetCards(sources: readonly Source[]): readonly TargetComparisonCard[] {
  const first = Math.min(0, ...sources.map((s) => s.plot.domain[0]));
  const last = Math.max(1000, ...sources.map((s) => s.plot.domain[1]));
  const domain = [first, last] as const;
  const ticks = Array.from({ length: 5 }, (_, i) => {
    const at = first + ((last - first) * i) / 4;
    return { at, label: targetClock(at) };
  });
  return definitions.map((d) => {
    const metric = sources.length
      ? (d.keys.find((key) =>
          sources.every((s) => s.report.samples.some((sample) => targetReading(sample, key) !== null)),
        ) ?? null)
      : null;
    const series: ChartSeries[] = [];
    let unit = 'unknown';
    if (metric)
      for (const source of sources) {
        const projection = targetUnitProjection(source.report.units, metric, d.unit);
        if (!projection.declared) continue;
        unit = projection.label;
        series.push({
          key: source.id,
          label: source.label,
          tone: source.tone,
          xs: source.plot.points.map((p) => p.t),
          breaks: source.plot.points.map((p) => p.gap),
          values: source.plot.points.map((p) => projectTargetReading(targetReading(p.sample, metric), projection)),
        });
      }
    return { id: d.id, title: d.title, metric, unit, series, domain, ticks };
  });
}
