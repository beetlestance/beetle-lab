import { MetricAccumulatorError } from './snapshot.js';
import type { NumericTotal, SeriesTotal } from './snapshot.js';
import type { MetricPoint } from './types.js';

export function checkedSum(left: number, right: number, integer = false): number {
  const result = left + right;
  if (!Number.isFinite(result) || (integer && !Number.isSafeInteger(result))) throw new MetricAccumulatorError('overflow');
  return result;
}
export function seriesKey(point: MetricPoint): string {
  return `${point.metric}:${point.tags.request ?? ''}:${point.tags.assertion ?? ''}`;
}
function total(point: MetricPoint, previous?: NumericTotal): NumericTotal {
  switch (point.kind) {
    case 'counter': return counter(point.value, previous);
    case 'rate': return rate(point.value, previous);
    case 'trend': return trend(point.value, previous);
    case 'gauge': return gauge(point, previous);
  }
}
function counter(value: number, previous?: NumericTotal): NumericTotal {
  return { kind: 'counter', sum: checkedSum(previous?.kind === 'counter' ? previous.sum : 0, value, true) };
}
function rate(value: number, previous?: NumericTotal): NumericTotal {
  const old = previous?.kind === 'rate' ? previous : undefined;
  return { kind: 'rate', numerator: checkedSum(old?.numerator ?? 0, value, true),
    sampleCount: checkedSum(old?.sampleCount ?? 0, 1, true) };
}
function trend(value: number, previous?: NumericTotal): NumericTotal {
  const old = previous?.kind === 'trend' ? previous : undefined;
  if (!old) return { kind: 'trend', count: 1, sum: value, min: value, max: value, mean: value };
  const count = checkedSum(old.count, 1, true);
  const sum = checkedSum(old.sum, value);
  return { kind: 'trend', count, sum, min: Math.min(old.min, value),
    max: Math.max(old.max, value), mean: sum / count };
}
function gauge(point: MetricPoint, previous?: NumericTotal): NumericTotal {
  const old = previous?.kind === 'gauge' ? previous : undefined;
  const latest = !old || point.timeMs >= old.sourceTimeMs;
  return { kind: 'gauge', latest: latest ? point.value : old.latest,
    sourceTimeMs: latest ? point.timeMs : old.sourceTimeMs,
    min: Math.min(old?.min ?? point.value, point.value), max: Math.max(old?.max ?? point.value, point.value) };
}
export function accumulate(series: Map<string, SeriesTotal>, point: MetricPoint, maximum: number): void {
  const key = seriesKey(point);
  const previous = series.get(key);
  if (!previous && series.size >= maximum) throw new MetricAccumulatorError('series_limit');
  series.set(key, { metric: point.metric, kind: point.kind, tags: point.tags, total: total(point, previous?.total) });
}
