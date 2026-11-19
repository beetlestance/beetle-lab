import { projectTargetReading, targetUnitProjection } from '@beetle/contracts/target-runtime';
import type { TargetRuntimeUnits, TargetUnit } from '@beetle/contracts/target-runtime';
import type { TargetPoint } from './history.js';
import type { ChartSeries } from './LiveChart.js';

type TargetKey = keyof TargetPoint['values'];
type Line = readonly [TargetKey, string, ChartSeries['tone']];
interface Definition {
  readonly title: string;
  readonly lines: readonly Line[];
  readonly preferred: TargetUnit;
  readonly area?: boolean;
}
export interface LiveTargetChart {
  readonly title: string;
  readonly series: readonly ChartSeries[];
  readonly normalized: boolean;
  readonly unit: string;
}
const value = (point: TargetPoint, key: TargetKey) => (point.status === 'ready' ? (point.values[key] ?? null) : null);
const has = (points: readonly TargetPoint[], key: TargetKey) => points.some((point) => value(point, key) !== null);

/** Source observations stay untouched. A group converts only when every known series declares units. */
export function liveTargetCharts(
  points: readonly TargetPoint[],
  units: TargetRuntimeUnits | undefined,
): LiveTargetChart[] {
  const heap: TargetKey = has(points, 'usedHeapSize')
    ? 'usedHeapSize'
    : has(points, 'heapAlloc')
      ? 'heapAlloc'
      : 'heapInuse';
  const handles = has(points, 'activeHandles') ? 'activeHandles' : 'goroutines';
  const definitions: readonly Definition[] = [
    {
      title: 'Heap and RSS',
      lines: [
        [heap, 'heap', 'amber'],
        ['rss', 'RSS', 'info'],
      ],
      preferred: 'megabytes',
    },
    {
      title: 'CPU',
      lines: [
        ['cpuPercent', 'process', 'amber'],
        ['systemCpuPercent', 'system', 'mute'],
      ],
      preferred: 'percent',
    },
    {
      title: 'Event-loop delay',
      lines: [
        ['eventLoopDelay.mean', 'mean', 'info'],
        ['eventLoopDelay.p99', 'p99', 'amber'],
        ['eventLoopDelay.max', 'max', 'violet'],
      ],
      preferred: 'milliseconds',
    },
    {
      title: handles === 'goroutines' ? 'Goroutines' : 'Active handles',
      lines: [[handles, handles === 'goroutines' ? 'goroutines' : 'handles', 'ink']],
      preferred: 'count',
      area: true,
    },
  ];
  return definitions
    .filter((definition) => definition.lines.some(([key]) => has(points, key)))
    .map((definition) => projectChart(points, units, definition));
}

function projectChart(
  points: readonly TargetPoint[],
  units: TargetRuntimeUnits | undefined,
  definition: Definition,
): LiveTargetChart {
  const active = definition.lines.filter(([key]) => has(points, key));
  const normalized = active.every(([key]) => units?.[key] !== undefined);
  const unit = normalized ? targetUnitProjection(units, active[0]![0], definition.preferred).label : 'raw';
  return {
    title: definition.title,
    normalized,
    unit,
    series: definition.lines.map(([key, label, tone]) => {
      const declared = units?.[key];
      const projection = normalized ? targetUnitProjection(units, key, definition.preferred) : null;
      const rawLabel = declared === undefined ? 'raw' : targetUnitProjection(units, key, declared).label;
      return {
        key,
        label: normalized ? label : `${label} (${rawLabel})`,
        tone,
        area: definition.area ?? false,
        values: points.map((point) =>
          projection ? projectTargetReading(value(point, key), projection) : value(point, key),
        ),
      };
    }),
  };
}
