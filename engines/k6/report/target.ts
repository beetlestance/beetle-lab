import {
  captureTargetRuntimeReport,
  observationSummary,
  targetUnitProjection,
  projectTargetReading,
} from '@beetle/contracts/target-runtime';
import type { TargetMetricName, TargetRuntimeReport } from '@beetle/contracts/target-runtime';
import type { ReportWriter } from './writer.js';
const memoryRows: readonly [TargetMetricName, string][] = [
  ['rss', 'RSS'],
  ['heapAlloc', 'Allocated heap'],
  ['heapInuse', 'In-use heap'],
  ['heapSys', 'Heap reserved from OS'],
  ['heapIdle', 'Idle heap'],
  ['heapReleased', 'Released heap'],
  ['stackInuse', 'In-use stack'],
  ['external', 'External memory'],
  ['arrayBuffers', 'ArrayBuffers'],
  ['totalHeapSize', 'Total heap'],
  ['usedHeapSize', 'Used heap'],
  ['heapSizeLimit', 'Heap limit'],
  ['mallocedMemory', 'Malloced memory'],
  ['peakMallocedMemory', 'Peak malloced memory'],
  ['cppHeap.allocated_size', 'C++ heap allocated'],
  ['cppHeap.used_size', 'C++ heap used'],
];
function number(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'unknown' : value.toFixed(2);
}
function change(before: number | null, after: number | null, ordered: boolean): number | null {
  return !ordered || before === null || after === null ? null : after - before;
}
function row(writer: ReportWriter, report: TargetRuntimeReport, metric: TargetMetricName, label: string): void {
  const s = observationSummary(report, metric);
  const ordered = s.clockOrdered && s.phaseOrdered && !s.resetObserved;
  const projection = targetUnitProjection(report.units, metric);
  const display = (value: number | null) => number(projectTargetReading(value, projection));
  writer.line(
    `${label} (${projection.label}): baseline=${display(s.baseline)}; lastDuringLoad=${display(s.loadFinal)}; firstPostLoad=${display(s.postLoad)}; afterCooldown=${display(s.final)}; peakDuringLoad=${display(s.peak)}; changeAfterCooldown=${display(change(s.baseline, s.final, ordered))}`,
  );
}
function counterDelta(report: TargetRuntimeReport, metric: 'gc.count' | 'gc.totalMs', ordered: boolean): number | null {
  const summary = observationSummary(report, metric);
  const delta = change(summary.baseline, summary.postLoad, ordered && !summary.resetObserved);
  return delta !== null && delta >= 0 ? delta : null;
}
function gc(writer: ReportWriter, report: TargetRuntimeReport, ordered: boolean): void {
  writer.line('[Target garbage collection]');
  const deltaCount = counterDelta(report, 'gc.count', ordered);
  const deltaTime = counterDelta(report, 'gc.totalMs', ordered);
  const projection = targetUnitProjection(report.units, 'gc.totalMs');
  writer.line(`Observed baseline-to-post-load GC count change: ${number(deltaCount)}`);
  writer.line(
    `Observed baseline-to-post-load GC time change (${projection.label}): ${number(projectTargetReading(deltaTime, projection))}`,
  );
  const average = meanPause(report, deltaCount, deltaTime);
  writer.line(
    `Mean pause from those counter changes (${projection.label}): ${number(projectTargetReading(average, projection))}`,
  );
  row(writer, report, 'gc.count', 'Target cumulative GC count');
  row(writer, report, 'gc.totalMs', 'Target cumulative GC time');
  row(writer, report, 'gc.avgMs', 'Target reported cumulative average pause');
  row(writer, report, 'gc.maxMs', 'Target reported cumulative maximum pause');
  row(writer, report, 'gc.duration', 'Legacy gc.duration');
  writer.line(
    'Counter changes assume no unobserved reset. Cumulative average/max readings are not per-run pause statistics.',
  );
}
function meanPause(report: TargetRuntimeReport, count: number | null, time: number | null): number | null {
  if (report.units?.['gc.count'] !== 'count' || count === null || count <= 0 || time === null) return null;
  const value = time / count;
  return time > 0 && value === 0 ? null : value;
}
function interpretation(writer: ReportWriter, report: TargetRuntimeReport): void {
  writer.line('[Target observations: interpretation]');
  const rss = observationSummary(report, 'rss');
  const projection = targetUnitProjection(report.units, 'rss');
  if (rss.resetObserved)
    writer.line(
      'Target uptime decreased: a restart/reset was observed; memory and cumulative-counter comparisons are unknown.',
    );
  else if (!rss.clockOrdered || !rss.phaseOrdered)
    writer.line('Observation chronology is inconsistent; comparisons are unknown.');
  else if (rss.delta === null) writer.line('A final post-load RSS comparison is unavailable.');
  else if (rss.delta > 0)
    writer.line(
      `RSS remains ${number(projectTargetReading(rss.delta, projection))} ${projection.label} above baseline in the final observation; investigate retained memory over repeated runs.`,
    );
  else writer.line('Final observed RSS is at or below baseline.');
  writer.line(
    'These target-reported observations neither establish a leak nor prove leak freedom and do not change the test outcome.',
  );
}
/** Bounded presentation only. The shared summary owner preserves missing points and chronology. */
export function appendTargetReport(writer: ReportWriter, input: TargetRuntimeReport | undefined): void {
  if (!input) {
    writer.line('Target runtime analysis: not requested.');
    return;
  }
  const report = captureTargetRuntimeReport(input);
  const chronology = observationSummary(report, 'rss');
  targetHeader(writer, report, chronology);
  writer.line('[Target memory]');
  for (const [metric, label] of memoryRows) row(writer, report, metric, label);
  writer.line('[Target CPU]');
  for (const metric of ['cpuPercent', 'systemCpuPercent'] as const) {
    row(writer, report, metric, metric);
    const projection = targetUnitProjection(report.units, metric);
    writer.line(
      `${metric} sampled during-load mean (${projection.label}): ${number(projectTargetReading(observationSummary(report, metric).mean, projection))}`,
    );
  }
  writer.line('[Target runtime and event loop]');
  for (const metric of [
    'activeHandles',
    'goroutines',
    'activeRequests',
    'heapObjects',
    'uvThreadpoolSize',
    'numCPU',
  ] as const)
    row(writer, report, metric, metric);
  for (const metric of [
    'eventLoopDelay.mean',
    'eventLoopDelay.p90',
    'eventLoopDelay.p99',
    'eventLoopDelay.max',
  ] as const)
    row(writer, report, metric, metric);
  gc(writer, report, chronology.clockOrdered && chronology.phaseOrdered);
  interpretation(writer, report);
}

function targetHeader(
  writer: ReportWriter,
  report: TargetRuntimeReport,
  chronology: ReturnType<typeof observationSummary>,
): void {
  writer.line('[Target runtime observations]');
  writer.line(
    `Source: ${report.scope}; retained samples=${report.samples.length}; missed=${report.missed}; limited=${report.limited}`,
  );
  writer.line(
    `Observation times: baseline=${chronology.before?.observedAt ?? 'unknown'}; lastDuringLoad=${chronology.lastDuring?.observedAt ?? 'unknown'}; firstPostLoad=${chronology.firstAfter?.observedAt ?? 'unknown'}; afterCooldown=${chronology.after?.observedAt ?? 'unknown'}`,
  );
  writer.line(
    'Checkpoint readings remain unknown when unavailable; peaks/means use observed during-load points, not continuous measurement.',
  );
}
