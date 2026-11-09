import type { DispatchStore } from './dispatch.js';
import type { RunnerGateway } from './runner.js';
import type { RunReader } from './runs.js';

/** Private bounded delivery owner; no public Run state or receipt is fabricated. */
export interface DeliveryRuntimeState {
  readonly status: 'running' | 'failed' | 'closed';
  readonly active: boolean;
  readonly reason: 'operation_failure' | 'failure_notification' | null;
}
export interface DeliveryRuntime {
  state(): DeliveryRuntimeState;
  /** Stop scheduling, abort hints, then await all original calls and durable custody. */
  close(): Promise<void>;
}
export interface DeliveryRuntimeOptions {
  readonly store: DispatchStore;
  readonly runs: Pick<RunReader, 'getRun'>;
  /** Same installation gateway/credits as capacity; this owner never closes it. */
  readonly gateway: RunnerGateway;
  /** Called once on fatal failure; await original completion; never await delivery/composite close. */
  readonly onFailure: (error: unknown) => Promise<void>;
  /** Internal scheduler interval: default250, safe integer25..60000 milliseconds. */
  readonly intervalMs?: number;
}
