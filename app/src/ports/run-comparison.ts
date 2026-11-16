import type { ResultDigest } from '@beetle/contracts';
import type { RunComparisonRequest, RunComparisonSnapshot } from '@beetle/contracts/api';
import type { RunReader } from './runs.js';
import type { RunResultReader } from './run-results.js';
import type { SuiteReader } from './suites.js';
import type { MetricReadContext, RunMetricLookupReader } from './run-metrics.js';
export interface RunComparisonOptions {
  readonly runs: Pick<RunReader, 'getRun'>;
  readonly results: RunResultReader;
  readonly suites: Pick<SuiteReader, 'getRevision'>;
  readonly metrics: RunMetricLookupReader;
  readonly digest: ResultDigest;
}
export interface RunComparisonService {
  /** Actual original; transport owns its cancellation/deadline race and retains this promise. */
  compare(request: RunComparisonRequest, context: MetricReadContext): Promise<RunComparisonSnapshot>;
  close(): Promise<void>;
}
export class ComparisonError extends Error {
  constructor(readonly code: 'invalid_input' | 'conflict' | 'busy' | 'closed' | 'unavailable') {
    super('Run comparison unavailable'); this.name = 'ComparisonError';
  }
}
