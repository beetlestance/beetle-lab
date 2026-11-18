import type { RunHistoryMetricReader } from './run-history.js';
import type {
  RunLatencyAttribution,
  RunMetricOverview,
  RunChartHistory,
  RunMetricKey,
  RunMetricSeries,
  RunMetricSeriesPage,
  RunMetricSamplesPage,
} from '@beetle/contracts/api';
import type { RunKey } from './runs.js';
import type { RunArtifactsReader } from './run-artifacts.js';
import type { OutputByteStore } from './output-bytes.js';

export interface MetricReadContext {
  readonly signal: AbortSignal;
  readonly deadline: number;
}
export interface RunMetricSeriesQuery extends RunKey {
  readonly attemptId: string;
  readonly limit: number;
  readonly cursor?: string;
}
export interface RunMetricSamplesQuery extends RunMetricSeriesQuery {
  readonly seriesOrdinal: number;
  readonly fromTimeMs?: number;
  readonly toTimeMs?: number;
}
/** One original operation; callers retain cancellation/deadline ownership. */
export interface RunMetricsReader {
  getRunChartHistory(
    query: RunKey & { readonly attemptId: string },
    context: MetricReadContext,
  ): Promise<RunChartHistory>;
  getRunMetricOverview(
    query: RunKey & { readonly attemptId: string },
    context: MetricReadContext,
  ): Promise<RunMetricOverview>;
  listRunMetricSeries(query: RunMetricSeriesQuery, context: MetricReadContext): Promise<RunMetricSeriesPage>;
  getRunMetricSamples(query: RunMetricSamplesQuery, context: MetricReadContext): Promise<RunMetricSamplesPage>;
  /** Derived p95-rise attribution from the whole published history; rise is null when not stated. */
  getRunLatencyAttribution(
    query: RunKey & { readonly attemptId: string },
    context: MetricReadContext,
  ): Promise<RunLatencyAttribution>;
}
export interface RunMetricsService extends RunMetricLookupReader, RunHistoryMetricReader {
  readonly reader: RunMetricsReader;
  /** Fence synchronously, abort and drain originals; shared adapters remain owned by bootstrap. */
  close(): Promise<void>;
}

/** Incremental SHA256 supplied by composition; one instance per verified full read. */
export interface MetricDigest {
  update(bytes: Uint8Array): void;
  hex(): string;
}
export interface RunMetricServiceOptions {
  readonly artifacts: RunArtifactsReader;
  readonly bytes?: Pick<OutputByteStore, 'read'>;
  readonly createDigest?: () => MetricDigest;
}

export type MetricReadErrorCode =
  'invalid_input' | 'busy' | 'closed' | 'cancelled' | 'deadline' | 'integrity' | 'unavailable';
/** Fixed boundary classification; source values never enter the public message. */
export class MetricReadError extends Error {
  constructor(readonly code: MetricReadErrorCode) {
    super('Metric history read failed');
    this.name = 'MetricReadError';
  }
}

/** Internal exact identity lookup; promise retains the actual original through cleanup. */
export interface RunMetricLookupQuery extends RunKey {
  readonly attemptId: string;
  readonly metric: RunMetricKey;
}
export interface RunMetricLookupResult {
  readonly source: Omit<RunMetricSeriesPage, 'items' | 'nextCursor'>;
  readonly series: RunMetricSeries | null;
}
export interface RunMetricLookupReader {
  lookupRunMetricSeries(query: RunMetricLookupQuery, context: MetricReadContext): Promise<RunMetricLookupResult>;
}
