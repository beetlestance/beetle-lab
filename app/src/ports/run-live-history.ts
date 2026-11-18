import type { ClientResult } from '@beetle/contracts';
import type { LiveMetricHistory } from '@beetle/contracts/api';
import type { RunnerAttemptIdentity } from './runner.js';
import type { RunLiveMetricQuery } from './run-live-metrics.js';
import type { MetricReadContext } from './run-metrics.js';
export interface RunnerLiveHistoryGateway {
  liveHistory(identity: RunnerAttemptIdentity, signal?: AbortSignal): Promise<ClientResult<LiveMetricHistory>>;
}
export interface RunLiveHistoryService {
  readonly reader: {
    getRunLiveHistory(query: RunLiveMetricQuery, context: MetricReadContext): Promise<LiveMetricHistory>;
  };
  close(): Promise<void>;
}
