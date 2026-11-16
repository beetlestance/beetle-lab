import type { RunMetricSeries, RunMetricValue } from '../generated/types.js';
export function metricValueMatches(v: RunMetricValue): boolean {
  if (v.kind === 'counter') return !Object.is(v.sum, -0);
  if (v.kind === 'rate') return v.numerator <= v.sampleCount && v.ratio === (v.sampleCount ? v.numerator / v.sampleCount : null);
  if (v.kind === 'gauge') return v.min <= v.latest && v.latest <= v.max;
  return trendMatches(v);
}
function trendMatches(v: Extract<RunMetricValue, {kind: 'trend'}>): boolean {
  if (v.min > v.max || v.mean !== v.sum / v.count) return false;
  if (v.count === 1 && (v.sum !== v.min || v.sum !== v.max)) return false;
  if (v.max === 0 && v.sum !== 0) return false;
  const values = (['p50', 'p90', 'p95', 'p99'] as const).map(key => v.percentiles[key]);
  return values.every(p => p.lower <= p.estimate && p.estimate <= p.upper && p.lower >= v.min && p.upper <= v.max)
    && values.every((p, i) => i === 0 || p.estimate >= values[i - 1]!.estimate);
}
export function metricDescriptorMatches(s: RunMetricSeries): boolean {
  const unit = s.kind === 'trend' ? 'ms' : s.kind === 'rate' ? 'ratio' : s.metric === 'data_sent' || s.metric === 'data_received' ? 'bytes' : 'count';
  return s.kind === s.total.kind && s.unit === unit && s.tags.phase !== 'prepare' && metricValueMatches(s.total);
}
