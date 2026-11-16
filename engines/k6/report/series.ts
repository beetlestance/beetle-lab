import { captureMetricSeries, metricSeriesIdentity, projectMetricSeries } from '@beetle/contracts/metrics';
import type { SeriesTotal } from '@beetle/contracts/metrics';
import type { RunMetricSeries, RunMetricValue } from '@beetle/contracts/api';
import { ReportError } from './writer.js';

export const statisticColumns = ['sum', 'count', 'numerator', 'sampleCount', 'ratio', 'latest', 'sourceTimeMs', 'min', 'max', 'mean',
  ...['p50', 'p90', 'p95', 'p99'].flatMap(p => [p, `${p}Lower`, `${p}Upper`]), 'percentileMethod'] as const;
export type Statistic = number | string | null;
function ordinary(value: RunMetricValue): Statistic[] {
  const common = {sum: null, count: null, numerator: null, sampleCount: null, ratio: null, latest: null,
    sourceTimeMs: null, min: null, max: null, mean: null, ...value};
  return [common.sum, common.count, common.numerator, common.sampleCount, common.ratio, common.latest,
    common.sourceTimeMs, common.min, common.max, common.mean];
}
export function statistics(value: RunMetricValue): Statistic[] {
  const quantiles = value.kind === 'trend' ? Object.values(value.percentiles).flatMap(p => [p.estimate, p.lower, p.upper]) : Array<null>(12).fill(null);
  return [...ordinary(value), ...quantiles, value.kind === 'trend' ? 'histogram-estimate' : null];
}
/** Actual observed numeric totals only; absence is declared by the report, never filled with zero. */
export function captureSeries(input: readonly SeriesTotal[]): readonly RunMetricSeries[] {
  if (!Array.isArray(input) || input.length > 4600) throw new ReportError('invalid_input');
  const identities = new Set<string>();
  return input.map((item, index) => {
    const captured = captureMetricSeries(item); const identity = metricSeriesIdentity(captured);
    if (identities.has(identity)) throw new ReportError('invalid_input'); identities.add(identity);
    return projectMetricSeries(captured, index);
  });
}
export function describe(value: RunMetricSeries): string {
  const labels = Object.entries(value.tags).map(([key, item]) => `${key}=${item}`).join(',');
  const values = statistics(value.total).map((item, index) => item === null ? null : `${statisticColumns[index]}=${item}`)
    .filter((item): item is string => item !== null).join(' ');
  return `${value.scope} ${value.metric}${labels ? `{${labels}}` : ''} [${value.unit}]: ${values}`;
}
