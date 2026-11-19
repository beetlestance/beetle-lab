import {
  targetReading,
  targetUnitProjection,
  projectTargetReading,
  observationSummary,
} from '@beetle/contracts/target-runtime';
import type {
  TargetMetricName,
  TargetRuntimeReport,
  TargetRuntimeSample,
  TargetUnit,
} from '@beetle/contracts/target-runtime';
import type { ChartSeries, ChartTick } from '../live/LiveChart.js';
import { clock, reading } from '../live/format.js';

type Point = {
  readonly ordinal: number;
  readonly t: number;
  readonly sample: TargetRuntimeSample;
  readonly gap: boolean;
};
type Line = readonly [TargetMetricName, string, ChartSeries['tone']];
interface CardDefinition {
  id: string;
  title: string;
  lines: readonly Line[];
  preferred: TargetUnit;
}
export interface TargetCard {
  readonly id: string;
  readonly title: string;
  readonly series: readonly ChartSeries[];
  readonly normalized: boolean;
  readonly unit: string;
  readonly anyReading: boolean;
}
export interface RecordedTargetPlot {
  readonly points: readonly Point[];
  readonly domain: readonly [number, number];
  readonly ticks: readonly ChartTick[];
  readonly cards: readonly TargetCard[];
  readonly nativeTime: boolean;
  readonly omittedTimestamps: number;
  readonly chronologySafe: boolean;
}

/** A detached report is already bounded to 256 samples; no synthetic samples or sorting. */
export function recordedTargetPlot(report: TargetRuntimeReport, nativeOrigin: number | null): RecordedTargetPlot {
  const nativeTime = nativeOrigin !== null && Number.isFinite(nativeOrigin);
  const origin = nativeTime
    ? nativeOrigin
    : (report.samples.map((s) => Date.parse(s.observedAt)).find(Number.isFinite) ?? 0);
  const points: Point[] = [];
  report.samples.forEach((sample, ordinal) => {
    const t = Date.parse(sample.observedAt) - origin;
    if (!Number.isFinite(t)) return;
    const previous = points.at(-1);
    points.push({
      ordinal,
      t,
      sample,
      gap: previous !== undefined && (ordinal !== previous.ordinal + 1 || t <= previous.t),
    });
  });
  const first = Math.min(0, ...points.map((p) => p.t));
  const last = Math.max(0, first + 1000, ...points.map((p) => p.t));
  const domain = [first, last] as const;
  const chronology = observationSummary(report, 'rss');
  return {
    points,
    domain,
    nativeTime,
    omittedTimestamps: report.samples.length - points.length,
    chronologySafe: chronology.clockOrdered && chronology.phaseOrdered && !chronology.resetObserved,
    ticks: Array.from({ length: 5 }, (_, i) => {
      const at = first + ((last - first) * i) / 4;
      return { at, label: targetClock(at) };
    }),
    cards: cards(report, points),
  };
}

function has(points: readonly Point[], key: TargetMetricName): boolean {
  return points.some((point) => targetReading(point.sample, key) !== null);
}
function cards(report: TargetRuntimeReport, points: readonly Point[]): TargetCard[] {
  const heap = has(points, 'usedHeapSize') ? 'usedHeapSize' : has(points, 'heapAlloc') ? 'heapAlloc' : 'heapInuse';
  const handles = has(points, 'activeHandles')
    ? 'activeHandles'
    : has(points, 'goroutines')
      ? 'goroutines'
      : 'activeHandles';
  const activity = has(points, handles) ? (handles === 'goroutines' ? 'Goroutines' : 'Active handles') : 'Activity';
  return [
    card(report, points, {
      id: 'memory',
      title: 'Heap and RSS',
      lines: [
        [heap, 'heap', 'amber'],
        ['rss', 'RSS', 'info'],
      ],
      preferred: 'megabytes',
    }),
    card(report, points, {
      id: 'cpu',
      title: 'CPU',
      lines: [
        ['cpuPercent', 'process', 'amber'],
        ['systemCpuPercent', 'system', 'mute'],
      ],
      preferred: 'percent',
    }),
    card(report, points, {
      id: 'loop',
      title: 'Event-loop delay',
      lines: [
        ['eventLoopDelay.mean', 'mean', 'info'],
        ['eventLoopDelay.p99', 'p99', 'amber'],
        ['eventLoopDelay.max', 'max', 'violet'],
      ],
      preferred: 'milliseconds',
    }),
    card(report, points, {
      id: 'activity',
      title: activity,
      lines: [[handles, handles === 'goroutines' ? 'goroutines' : 'handles', 'ink']],
      preferred: 'count',
    }),
  ];
}

function card(report: TargetRuntimeReport, points: readonly Point[], definition: CardDefinition): TargetCard {
  const { id, title, lines, preferred } = definition;
  const active = lines.filter(([key]) => has(points, key));
  const normalized = active.length > 0 && active.every(([key]) => report.units?.[key] !== undefined);
  const unit = normalized ? targetUnitProjection(report.units, active[0]![0], preferred).label : 'raw';
  const series = lines.map(([key, label, tone]) => {
    const sourceUnit = report.units?.[key];
    const projection = normalized ? targetUnitProjection(report.units, key, preferred) : null;
    const rawLabel = sourceUnit === undefined ? 'raw' : targetUnitProjection(report.units, key, sourceUnit).label;
    return {
      key,
      label: normalized ? label : `${label} (${rawLabel})`,
      tone,
      area: id === 'activity',
      values: points.map((point) => {
        const value = targetReading(point.sample, key);
        return projection ? projectTargetReading(value, projection) : value;
      }),
    };
  });
  return {
    id,
    title,
    series,
    normalized,
    unit,
    anyReading: series.some((line) => line.values.some((value) => value !== null)),
  };
}

export function targetCardReading(card: TargetCard, value: number): string {
  const magnitude = Math.abs(value);
  const text = magnitude >= 1e12 || (magnitude > 0 && magnitude < 0.001) ? value.toExponential(2) : reading(value);
  return !card.normalized || card.unit === 'count' ? text : card.unit === '%' ? `${text}%` : `${text} ${card.unit}`;
}
export function targetClock(value: number): string {
  if (value !== 0 && Math.abs(value) < 1000)
    return `${(value / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 })} s`;
  return value < 0 ? `−${clock(-value)}` : clock(value);
}
