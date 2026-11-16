import type { TargetMetricName, TargetRuntimeReport, TargetRuntimeSample } from './types.js';
const memoryMetrics = new Set<TargetMetricName>(['rss', 'heapAlloc', 'heapInuse', 'heapSys', 'totalHeapSize',
  'usedHeapSize', 'external', 'arrayBuffers', 'mallocedMemory', 'cppHeap.allocated_size', 'cppHeap.used_size']);
export function targetReading(sample: TargetRuntimeSample | undefined, metric: TargetMetricName): number | null {
  const reading = sample?.status === 'ready' ? sample.values[metric] : null;
  return typeof reading === 'number' && Number.isFinite(reading) && reading >= 0 ? reading : null;
}
export function observationSummary(report: TargetRuntimeReport, metric: TargetMetricName) {
  const before = report.samples.find(sample => sample.phase === 'before');
  const after = report.samples.findLast(sample => sample.phase === 'after');
  const firstAfter = report.samples.find(sample => sample.phase === 'after');
  const lastDuring = report.samples.findLast(sample => sample.phase === 'during');
  const during = report.samples.filter(sample => sample.phase === 'during').map(sample => targetReading(sample, metric));
  const known = during.filter((reading): reading is number => reading !== null);
  const baseline = targetReading(before, metric); const final = targetReading(after, metric);
  const timestamps = report.samples.map(sample => Date.parse(sample.observedAt));
  const clockOrdered = timestamps.every((timestamp, index) => Number.isFinite(timestamp) && (index === 0 || timestamp >= timestamps[index - 1]!));
  const phaseOrder = {before: 0, during: 1, after: 2};
  const phaseOrdered = report.samples.every((sample, index) => index === 0 || phaseOrder[sample.phase] >= phaseOrder[report.samples[index - 1]!.phase]);
  const resetObserved = targetResetObserved(report) || counterResetObserved(report, metric);
  const change = clockOrdered && phaseOrdered && !resetObserved ? pointChange(baseline, final) : {delta: null, percent: null};
  return {before, after, firstAfter, lastDuring, baseline, final, postLoad: targetReading(firstAfter, metric),
    loadFinal: targetReading(lastDuring, metric), mean: mean(known), peak: known.length ? Math.max(...known) : null,
    ...change, clockOrdered, phaseOrdered, resetObserved,
    investigateMemory: memoryMetrics.has(metric) && change.delta !== null && change.delta > 0 && clockOrdered,
    known: report.samples.filter(sample => targetReading(sample, metric) !== null).length};
}

function pointChange(baseline: number | null, final: number | null) {
  if (baseline === null || final === null) return {delta: null, percent: null};
  const delta = final - baseline; const percent = baseline > 0 ? delta / baseline * 100 : null;
  return {delta, percent: percent !== null && Number.isFinite(percent) ? percent : null};
}

function mean(values: readonly number[]): number | null {
  if (!values.length) return null;
  let result = 0;
  for (let index = 0; index < values.length; index++) result += (values[index]! - result) / (index + 1);
  return Number.isFinite(result) ? result : null;
}

export function observedMetricDecrease(report: TargetRuntimeReport, metric: TargetMetricName): boolean {
  let previous: number | null = null;
  for (const sample of report.samples) {
    const current = targetReading(sample, metric);
    if (current !== null && previous !== null && current < previous) return true;
    if (current !== null) previous = current;
  }
  return false;
}

export function targetResetObserved(report: TargetRuntimeReport): boolean {
  return observedMetricDecrease(report, 'uptime');
}

function counterResetObserved(report: TargetRuntimeReport, metric: TargetMetricName): boolean {
  return (metric === 'gc.count' || metric === 'gc.totalMs') && observedMetricDecrease(report, metric);
}
