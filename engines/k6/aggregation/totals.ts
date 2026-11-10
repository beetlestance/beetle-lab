import { metricSeriesKey } from '../plan/index.js';
import { MetricAccumulatorError } from './snapshot.js';
import type { AccumulatedTotal, AccumulatedSeries } from './snapshot.js';
import { DurationHistogram } from './distribution.js';
import type { MetricPoint } from './types.js';

export function checkedSum(left: number, right: number, integer = false): number {
  const result = left + right;
  if (!Number.isFinite(result) || (integer && !Number.isSafeInteger(result))) throw new MetricAccumulatorError('overflow');
  return result;
}
export function seriesKey(point: MetricPoint): string {
  return metricSeriesKey(point.metric, point.tags);
}
function total(point: MetricPoint, previous?: AccumulatedTotal): AccumulatedTotal {
  switch (point.kind) {
    case 'counter': return counter(point.value, previous);
    case 'rate': return rate(point.value, previous);
    case 'trend': return trend(point.value, previous);
    case 'gauge': return gauge(point, previous);
  }
}
function counter(value: number, previous?: AccumulatedTotal): AccumulatedTotal {
  return { kind: 'counter', sum: checkedSum(previous?.kind === 'counter' ? previous.sum : 0, value, true) };
}
function rate(value: number, previous?: AccumulatedTotal): AccumulatedTotal {
  const old = previous?.kind === 'rate' ? previous : undefined;
  return { kind: 'rate', numerator: checkedSum(old?.numerator ?? 0, value, true),
    sampleCount: checkedSum(old?.sampleCount ?? 0, 1, true) };
}
function trend(value: number, previous?: AccumulatedTotal): AccumulatedTotal {
  const old = previous?.kind === 'trend' ? previous : undefined;
  if (!old) {
    const distribution = new DurationHistogram(); distribution.record(value);
    return { kind: 'trend', count: 1, sum: value, min: value, max: value, mean: value, distribution };
  }
  const count = checkedSum(old.count, 1, true);
  const sum = checkedSum(old.sum, value);
  old.distribution.record(value);
  return { kind: 'trend', count, sum, min: Math.min(old.min, value),
    max: Math.max(old.max, value), mean: sum / count, distribution: old.distribution };
}
function gauge(point: MetricPoint, previous?: AccumulatedTotal): AccumulatedTotal {
  const old = previous?.kind === 'gauge' ? previous : undefined;
  const latest = !old || point.timeMs >= old.sourceTimeMs;
  return { kind: 'gauge', latest: latest ? point.value : old.latest,
    sourceTimeMs: latest ? point.timeMs : old.sourceTimeMs,
    min: Math.min(old?.min ?? point.value, point.value), max: Math.max(old?.max ?? point.value, point.value) };
}
export function accumulate(series: Map<string, AccumulatedSeries>, point: MetricPoint, maximum: number): void {
  const key = seriesKey(point);
  const previous = series.get(key);
  if (!previous && series.size >= maximum) throw new MetricAccumulatorError('series_limit');
  series.set(key, { metric: point.metric, kind: point.kind, tags: point.tags, scope: point.tags.phase === 'prepare' ? 'prepare'
    : ['vus', 'vus_max', 'beetle_required_failures', 'beetle_execution_failures'].includes(point.metric) ? 'engine' : 'execute', total: total(point, previous?.total) });
}
