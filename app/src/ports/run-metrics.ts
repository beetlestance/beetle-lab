import type { RunMetricSeriesPage, RunMetricSamplesPage } from '@beetle/contracts/api';
import type { RunKey } from './runs.js';

export interface MetricReadContext { readonly signal: AbortSignal; readonly deadline: number }
export interface RunMetricSeriesQuery extends RunKey {
  readonly attemptId: string; readonly limit: number; readonly cursor?: string;
}
export interface RunMetricSamplesQuery extends RunMetricSeriesQuery {
  readonly seriesOrdinal: number; readonly fromTimeMs?: number; readonly toTimeMs?: number;
}
/** One original operation; callers retain cancellation/deadline ownership. */
export interface RunMetricsReader {
  listRunMetricSeries(query: RunMetricSeriesQuery, context: MetricReadContext): Promise<RunMetricSeriesPage>;
  getRunMetricSamples(query: RunMetricSamplesQuery, context: MetricReadContext): Promise<RunMetricSamplesPage>;
}
export interface RunMetricsService {
  readonly reader: RunMetricsReader;
  /** Fence synchronously, abort and drain originals; shared adapters remain owned by bootstrap. */
  close(): Promise<void>;
}
