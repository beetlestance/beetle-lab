import type { DurationDistribution } from './distribution-types.js';

export type MetricKind = 'counter' | 'gauge' | 'rate' | 'trend';
export type MetricScope = 'prepare' | 'execute' | 'engine' | 'control';
export interface MetricTags { readonly phase?: 'prepare' | 'execute'; readonly request?: string; readonly assertion?: string }
export type NumericTotal = Readonly<{ kind: 'counter'; sum: number }>
  | Readonly<{ kind: 'rate'; numerator: number; sampleCount: number }>
  | Readonly<{ kind: 'trend'; count: number; sum: number; min: number; max: number; mean: number; distribution: DurationDistribution }>
  | Readonly<{ kind: 'gauge'; latest: number; sourceTimeMs: number; min: number; max: number }>;
export interface SeriesTotal {
  readonly metric: string;
  readonly kind: MetricKind;
  readonly tags: MetricTags;
  readonly total: NumericTotal;
  readonly scope: MetricScope;
}
export interface MetricWindow {
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly series: readonly SeriesTotal[];
}
