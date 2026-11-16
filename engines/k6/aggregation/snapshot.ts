import type { DurationHistogram, NumericTotal, SeriesTotal } from '@beetle/contracts/metrics';
export type { NumericTotal, SeriesTotal, MetricWindow } from '@beetle/contracts/metrics';

export type AccumulatorCode = 'invalid_profile' | 'invalid_point' | 'series_limit' | 'overflow'
  | 'measurement' | 'cancelled' | 'closed' | 'busy' | 'sink_failed';
export class MetricAccumulatorError extends Error {
  constructor(readonly code: AccumulatorCode) { super('Metric accumulator rejected'); this.name = 'MetricAccumulatorError'; }
}
export type AccumulatedTotal = Exclude<NumericTotal, { kind: 'trend' }>
  | (Omit<Extract<NumericTotal, { kind: 'trend' }>, 'distribution'> & { readonly distribution: DurationHistogram });
export type AccumulatedSeries = Omit<SeriesTotal, 'total'> & { readonly total: AccumulatedTotal };
export interface MetricSnapshot {
  readonly totals: readonly SeriesTotal[];
  readonly totalsComplete: true;
  readonly measurement: Readonly<{ complete: true; sourceTimeMs: number }>;
  readonly windowCoverage: Readonly<{ complete: boolean; latePoints: number; markerDelayDroppedBuckets: number }>;
  readonly quantiles: 'histogram-estimate';
}
export function seriesSnapshot(series: ReadonlyMap<string, AccumulatedSeries>): readonly SeriesTotal[] {
  return Object.freeze([...series.values()].map(value => Object.freeze({
    ...value, tags: Object.freeze({ ...value.tags }), total: snapshotTotal(value.total),
  })));
}

function snapshotTotal(total: AccumulatedSeries['total']): NumericTotal {
  return total.kind === 'trend'
    ? Object.freeze({ ...total, distribution: total.distribution.snapshot() })
    : Object.freeze({ ...total });
}
