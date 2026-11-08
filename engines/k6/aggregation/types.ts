import type { AllowedMetricSeries, MetricTags, MetricKind, NativeMetricDefinition } from '../plan/index.js';
export type { MetricKind } from '../plan/index.js';
export type MetricDefinition = NativeMetricDefinition;
export interface MetricPoint {
  readonly metric: string;
  readonly kind: MetricKind;
  readonly value: number;
  readonly timeMs: number;
  readonly tags: MetricTags;
}
export type MetricStreamCode = 'invalid_profile' | 'invalid_record' | 'unknown_metric' | 'invalid_labels'
  | 'stream_limit' | 'record_limit' | 'line_limit' | 'torn_record' | 'cancelled' | 'closed' | 'busy' | 'sink_failed';
export class MetricStreamError extends Error {
  constructor(readonly code: MetricStreamCode) { super('Metric stream rejected'); this.name = 'MetricStreamError'; }
}
export interface MetricStreamOptions {
  readonly metrics: readonly MetricDefinition[];
  readonly allowedSeries?: readonly AllowedMetricSeries[];
  readonly requestLabels: readonly string[];
  readonly assertionLabels: readonly string[];
  /** Total parser work, distinct from persisted artifact quota. */
  readonly maximumBytes: number;
  readonly maximumRecords: number;
  /** Required bounded sink; receives only numeric projections and approved labels. */
  readonly point: (point: MetricPoint, signal: AbortSignal) => Promise<void>;
}
