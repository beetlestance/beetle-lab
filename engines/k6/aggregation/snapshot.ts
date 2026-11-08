import type { MetricKind, MetricPoint } from './types.js';

export type AccumulatorCode = 'invalid_profile' | 'invalid_point' | 'series_limit' | 'overflow'
  | 'measurement' | 'cancelled' | 'closed' | 'busy' | 'sink_failed';
export class MetricAccumulatorError extends Error {
  constructor(readonly code: AccumulatorCode) { super('Metric accumulator rejected'); this.name = 'MetricAccumulatorError'; }
}
export type NumericTotal = Readonly<{ kind: 'counter'; sum: number }>
  | Readonly<{ kind: 'rate'; numerator: number; sampleCount: number }>
  | Readonly<{ kind: 'trend'; count: number; sum: number; min: number; max: number; mean: number }>
  | Readonly<{ kind: 'gauge'; latest: number; sourceTimeMs: number; min: number; max: number }>;
export interface SeriesTotal {
  readonly metric: string;
  readonly kind: MetricKind;
  readonly tags: MetricPoint['tags'];
  readonly total: NumericTotal;
}
export interface MetricWindow {
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly series: readonly SeriesTotal[];
}
export interface MetricSnapshot {
  readonly totals: readonly SeriesTotal[];
  readonly totalsComplete: true;
  readonly measurement: Readonly<{ complete: true; sourceTimeMs: number }>;
  readonly windowCoverage: Readonly<{ complete: boolean; latePoints: number }>;
  readonly quantiles: 'unknown';
}
export function seriesSnapshot(series: ReadonlyMap<string, SeriesTotal>): readonly SeriesTotal[] {
  return Object.freeze([...series.values()].map(value => Object.freeze({
    ...value, tags: Object.freeze({ ...value.tags }), total: Object.freeze({ ...value.total }),
  })));
}
