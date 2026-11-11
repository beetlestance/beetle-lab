import type { MetricReadContext } from './run-metrics.js';
import type { Run } from '@beetle/contracts/api';
import type { RunKey } from './runs.js';
import type { EventBinding } from './events.js';
import type { ClientResult } from '@beetle/contracts';
import type { LiveMetricSnapshot } from '@beetle/contracts/api';
import type { RunnerAttemptIdentity } from './runner.js';
import type { RunnerOutputAbsenceGateway } from './output-absence.js';
/** Same installation gateway and original-call pool; no separate connection owner. */
export interface RunnerLiveMetricGateway extends RunnerOutputAbsenceGateway {
  liveMetrics(identity: RunnerAttemptIdentity, signal?: AbortSignal): Promise<ClientResult<LiveMetricSnapshot>>;
}

/** One scoped read transaction captures the current run and physical execution binding. */
export interface RunExecutionSnapshot {readonly run: Run; readonly binding: EventBinding | null}
export interface RunExecutionReader {getRunExecution(key: RunKey): Promise<RunExecutionSnapshot>}

export interface RunLiveMetricQuery extends RunKey {readonly attemptId: string}
export interface RunLiveMetricsService {
  readonly reader: {getRunLiveMetrics(query: RunLiveMetricQuery, context: MetricReadContext): Promise<LiveMetricSnapshot>};
  close(): Promise<void>;
}
