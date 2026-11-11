import type { TargetMetricName, TargetRuntimeReport, TargetRuntimeSample } from '@beetle/contracts/target-runtime';
const memoryMetrics = new Set<TargetMetricName>(['rss', 'heapAlloc', 'heapInuse', 'heapSys', 'totalHeapSize',
  'usedHeapSize', 'external', 'arrayBuffers', 'mallocedMemory', 'cppHeap.allocated_size', 'cppHeap.used_size']);
function value(sample: TargetRuntimeSample | undefined, metric: TargetMetricName): number | null {
  return sample?.status === 'ready' ? sample.values[metric] : null;
}
export function observationSummary(report: TargetRuntimeReport, metric: TargetMetricName) {
  const before = report.samples.find(sample => sample.phase === 'before');
  const after = report.samples.findLast(sample => sample.phase === 'after');
  const during = report.samples.filter(sample => sample.phase === 'during').map(sample => value(sample, metric));
  const known = during.filter((reading): reading is number => reading !== null);
  const baseline = value(before, metric); const final = value(after, metric);
  const timestamps = report.samples.map(sample => Date.parse(sample.observedAt));
  const clockOrdered = timestamps.every((timestamp, index) => Number.isFinite(timestamp) && (index === 0 || timestamp >= timestamps[index - 1]!));
  const phaseOrder = {before: 0, during: 1, after: 2};
  const phaseOrdered = report.samples.every((sample, index) => index === 0 || phaseOrder[sample.phase] >= phaseOrder[report.samples[index - 1]!.phase]);
  const change = clockOrdered && phaseOrdered ? pointChange(baseline, final) : {delta: null, percent: null};
  return {before, after, baseline, final, peak: known.length ? Math.max(...known) : null,
    ...change, clockOrdered, phaseOrdered,
    investigateMemory: memoryMetrics.has(metric) && change.delta !== null && change.delta > 0 && clockOrdered,
    known: report.samples.filter(sample => value(sample, metric) !== null).length};
}

function pointChange(baseline: number | null, final: number | null) {
  if (baseline === null || final === null) return {delta: null, percent: null};
  const delta = final - baseline; const percent = baseline > 0 ? delta / baseline * 100 : null;
  return {delta, percent: percent !== null && Number.isFinite(percent) ? percent : null};
}
