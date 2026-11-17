import { captureTargetRuntimeReport, observationSummary } from '@beetle/contracts/target-runtime';
import type { TargetMetricName, TargetRuntimeReport } from '@beetle/contracts/target-runtime';
import type { ReportWriter } from './writer.js';
const MiB = 1048576;
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
function number(value: number | null, divisor = 1): string {
  return value === null || !Number.isFinite(value) ? 'unknown' : (value / divisor).toFixed(2);
}
function change(before: number | null, after: number | null, ordered: boolean): number | null {
  return !ordered || before === null || after === null ? null : after - before;
}
function row(
  writer: ReportWriter,
  report: TargetRuntimeReport,
  metric: TargetMetricName,
  label: string,
  divisor = 1,
): void {
  const s = observationSummary(report, metric);
  const ordered = s.clockOrdered && s.phaseOrdered && !s.resetObserved;
  writer.line(
    `${label}: baseline=${number(s.baseline, divisor)}; lastDuringLoad=${number(s.loadFinal, divisor)}; firstPostLoad=${number(s.postLoad, divisor)}; afterCooldown=${number(s.final, divisor)}; peakDuringLoad=${number(s.peak, divisor)}; changeAfterCooldown=${number(change(s.baseline, s.final, ordered), divisor)}`,
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
  writer.line(`Observed baseline-to-post-load GC count change: ${number(deltaCount)}`);
  writer.line(`Observed baseline-to-post-load GC time change (ms): ${number(deltaTime)}`);
  const average = deltaCount !== null && deltaCount > 0 && deltaTime !== null ? deltaTime / deltaCount : null;
  writer.line(`Mean pause from those counter changes (ms): ${number(average)}`);
  row(writer, report, 'gc.count', 'Target cumulative GC count');
  row(writer, report, 'gc.totalMs', 'Target cumulative GC time (ms)');
  row(writer, report, 'gc.avgMs', 'Target reported cumulative average pause (ms)');
  row(writer, report, 'gc.maxMs', 'Target reported cumulative maximum pause (ms)');
  row(writer, report, 'gc.duration', 'Legacy gc.duration (target units; no millisecond conversion inferred)');
  writer.line(
    'Counter changes assume no unobserved reset. Cumulative average/max readings are not per-run pause statistics.',
  );
}
function interpretation(writer: ReportWriter, report: TargetRuntimeReport): void {
  writer.line('[Target observations: interpretation]');
  const rss = observationSummary(report, 'rss');
  if (rss.resetObserved)
    writer.line(
      'Target uptime decreased: a restart/reset was observed; memory and cumulative-counter comparisons are unknown.',
    );
  else if (!rss.clockOrdered || !rss.phaseOrdered)
    writer.line('Observation chronology is inconsistent; comparisons are unknown.');
  else if (rss.delta === null) writer.line('A final post-load RSS comparison is unavailable.');
  else if (rss.delta > 0)
    writer.line(
      `RSS remains ${number(rss.delta, MiB)} MiB above baseline in the final observation; investigate retained memory over repeated runs.`,
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
  writer.line('[Target memory (MiB)]');
  for (const [metric, label] of memoryRows) row(writer, report, metric, label, MiB);
  writer.line('[Target CPU (%)]');
  for (const metric of ['cpuPercent', 'systemCpuPercent'] as const) {
    row(writer, report, metric, metric);
    writer.line(`${metric} sampled during-load mean: ${number(observationSummary(report, metric).mean)}`);
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
    row(writer, report, metric, `${metric} (target units)`);
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
