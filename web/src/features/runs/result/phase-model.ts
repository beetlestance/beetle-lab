import {
  observationSummary,
  observedMetricDecrease,
  targetReading,
  targetGcPauseMaximum,
  targetUnitProjection,
  projectTargetReading,
} from '@beetle/contracts/target-runtime';
import type {
  TargetMetricName,
  TargetRuntimeReport,
  TargetRuntimeSample,
  TargetUnit,
} from '@beetle/contracts/target-runtime';

const phases = ['before', 'during', 'after'] as const;
type Values = readonly [number | null, number | null, number | null];
export interface PhaseRow {
  readonly name: string;
  readonly values: Values;
  readonly delta: number | null;
  readonly unit: string;
  readonly deltaUnit: string;
  readonly note: string;
}
export interface PhaseSummary {
  readonly rows: readonly PhaseRow[];
  readonly counts: readonly number[];
  readonly spans: readonly (number | null)[];
  readonly ordered: boolean;
}

export function targetPhaseSummary(report: TargetRuntimeReport): PhaseSummary {
  const chronology = observationSummary(report, 'rss');
  const ordered = chronology.clockOrdered && chronology.phaseOrdered && !chronology.resetObserved;
  const heap: TargetMetricName = has(report, 'usedHeapSize')
    ? 'usedHeapSize'
    : has(report, 'heapAlloc')
      ? 'heapAlloc'
      : 'heapInuse';
  const samples = phases.map((phase) => report.samples.filter((s) => s.phase === phase));
  const gc = gcRows(report, samples, ordered);
  return {
    ordered,
    counts: samples.map((group) => group.length),
    spans: samples.map((group) => (ordered ? elapsed(group) : null)),
    rows: [
      gauge(report, heap, heap === 'heapInuse' ? 'Heap in use' : 'Heap allocated / used', 'megabytes', ordered),
      gauge(report, 'rss', 'RSS', 'megabytes', ordered),
      ...gc,
      gauge(report, 'eventLoopDelay.mean', 'Event-loop delay, mean', 'milliseconds', ordered),
      gauge(report, 'eventLoopDelay.max', 'Event-loop delay, reported max', 'milliseconds', ordered),
      gauge(report, 'cpuPercent', 'CPU (process)', 'percent', ordered),
      gauge(report, 'activeHandles', 'Active handles', 'count', ordered),
    ],
  };
}
function has(report: TargetRuntimeReport, metric: TargetMetricName): boolean {
  return report.samples.some((s) => targetReading(s, metric) !== null);
}
function mean(values: readonly number[]): number | null {
  if (!values.length) return null;
  let result = 0;
  values.forEach((value, index) => {
    result += (value - result) / (index + 1);
  });
  return Number.isFinite(result) && (result !== 0 || values.every((value) => value === 0)) ? result : null;
}
function gauge(
  report: TargetRuntimeReport,
  metric: TargetMetricName,
  name: string,
  unit: TargetUnit,
  ordered: boolean,
): PhaseRow {
  const summary = observationSummary(report, metric);
  const projection = targetUnitProjection(report.units, metric, unit);
  const during = report.samples
    .filter((s) => s.phase === 'during')
    .map((s) => targetReading(s, metric))
    .filter((v): v is number => v !== null);
  const values: Values = [
    projectTargetReading(summary.baseline, projection),
    projectTargetReading(mean(during), projection),
    projectTargetReading(summary.final, projection),
  ];
  const label = projection.declared ? projection.label : 'raw';
  return row(name, values, label, ordered, 'First before point · mean of known during readings · last after point.');
}
function row(name: string, values: Values, unit: string, ordered: boolean, note: string): PhaseRow {
  const [before, during] = values;
  const delta = ordered && before !== null && during !== null ? during - before : null;
  return {
    name,
    values,
    delta: delta !== null && Number.isFinite(delta) ? delta : null,
    unit,
    deltaUnit: unit === '%' ? 'pp' : unit,
    note,
  };
}
function elapsed(samples: readonly TargetRuntimeSample[]): number | null {
  if (samples.length < 2) return null;
  const span = Date.parse(samples.at(-1)!.observedAt) - Date.parse(samples[0]!.observedAt);
  return Number.isFinite(span) && span > 0 ? span : null;
}
function divide(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) && (numerator === 0 || value !== 0) ? value : null;
}
function counterDelta(
  report: TargetRuntimeReport,
  samples: readonly TargetRuntimeSample[],
  metric: TargetMetricName,
): number | null {
  if (samples.length < 2 || report.units?.[metric] === undefined || observedMetricDecrease(report, metric)) return null;
  const projection = targetUnitProjection(report.units, metric);
  const first = targetReading(samples[0], metric);
  const last = targetReading(samples.at(-1), metric);
  if (first === null || last === null) return null;
  return projectTargetReading(last - first, projection);
}
function gcRows(
  report: TargetRuntimeReport,
  samples: readonly (readonly TargetRuntimeSample[])[],
  ordered: boolean,
): PhaseRow[] {
  const metrics = samples.map((group) => {
    if (!ordered) return [null, null, null, null] as const;
    const count = counterDelta(report, group, 'gc.count');
    const time = counterDelta(report, group, 'gc.totalMs');
    const span = elapsed(group);
    return [
      divide(count === null ? null : count * 60000, span),
      divide(time === null ? null : time * 100, span),
      divide(time, count),
      targetGcPauseMaximum(group),
    ] as const;
  });
  const note =
    'Counter difference within the recorded phase; requires two usable endpoints, declared units and no observed reset.';
  return [
    row('GC runs a minute', column(metrics, 0), '/min', ordered, note),
    row('Time spent in GC', column(metrics, 1), '%', ordered, note),
    row(
      'Longest GC pause',
      column(metrics, 3),
      'ms',
      ordered,
      'Longest pause between the recorded phase endpoints. Requires complete pause records in one collector generation.',
    ),
    row('Average GC pause', column(metrics, 2), 'ms', ordered, note),
  ];
}
export function phaseNumber(value: number | null, unit: string, signed = false): string {
  if (value === null) return '—';
  const magnitude = Math.abs(value);
  const text =
    magnitude >= 1e9 || (magnitude > 0 && magnitude < 0.01)
      ? value.toExponential(2)
      : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const sign = signed && value > 0 ? '+' : '';
  return `${sign}${text}${unit === '%' ? '%' : unit === 'count' ? '' : ` ${unit}`}`;
}
function column(values: readonly (readonly (number | null)[])[], index: number): Values {
  return [values[0]![index] ?? null, values[1]![index] ?? null, values[2]![index] ?? null];
}
