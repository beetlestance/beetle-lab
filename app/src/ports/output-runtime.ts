import type { OutputArtifactStore } from './output-artifacts.js';
import type { OutputFinalizations } from './output-finalization.js';
import type { RunnerOutputGateway } from './output-source.js';
import type { RunReader } from './runs.js';

export interface OutputRuntimeState {
  readonly status: 'running' | 'failed' | 'closed';
  readonly active: number;
  readonly problem: 'transport' | 'source_unavailable' | 'operation_failure' | 'failure_notification' | null;
}
export interface OutputRuntime {
  state(): OutputRuntimeState;
  /** Fence scheduling/transfers synchronously; drain originals before namespace release. */
  close(): Promise<void>;
}
export interface OutputRuntimeOptions {
  readonly dataRoot: string;
  readonly outputs: OutputArtifactStore;
  readonly finalizations: OutputFinalizations;
  readonly runs: Pick<RunReader, 'getRun'>;
  /** Shares the installation gateway; this owner cannot close or execute through it. */
  readonly gateway: Pick<RunnerOutputGateway, 'output'>;
  readonly freeSpaceReserveBytes: number;
  /** Once on fatal failure; must never await this runtime's close. */
  readonly onFailure: (error: unknown) => Promise<void>;
  /** Default250; safe integer25..60000 milliseconds. */
  readonly intervalMs?: number;
}
