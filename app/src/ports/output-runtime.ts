import type {ExportArtifacts,ExportExecutionStore} from './exports.js';
import type {RunnerExportGateway} from './export-runner.js';
import type {OutputBinding} from '../domain/output-owner/index.js';
import type { OutputByteStore } from './output-bytes.js';
import type { OutputArtifactStore } from './output-artifacts.js';
import type { OutputFinalizations } from './output-finalization.js';
import type { OutputAbsenceStore, RunnerOutputAbsenceGateway } from './output-absence.js';
import type { DispatchStore } from './dispatch.js';
import type { RunnerAttemptClient, RunnerAttemptIdentity } from './runner.js';
import type { RunReader } from './runs.js';
import type {RunnerRetirementGateway} from './runner-retirement.js';
import type {OutputDeletionMetadata} from './output-deletion-metadata.js';

export interface OutputRuntimeState {
  readonly status: 'running' | 'failed' | 'closed';
  readonly active: number;
  readonly problem: 'transport' | 'source_unavailable' | 'operation_failure' | 'failure_notification' | null;
}
export interface OutputRuntime {
  /** Present on the concrete installed runtime; read-only and shares its native owner. */
  readonly publishedBytes?: Pick<OutputByteStore<OutputBinding>, 'read'>;
  state(): OutputRuntimeState;
  /** Fence scheduling/transfers synchronously; drain originals before namespace release. */
  close(): Promise<void>;
}
export interface OutputRuntimeOptions {
  readonly deletions?:Pick<OutputDeletionMetadata,'scan'|'getFile'|'recordPlan'|'recordAbsence'|'reserveControl'>;
  readonly fileOnlyDeletion?:true;
  readonly retirement?:{readonly metadata:Pick<OutputDeletionMetadata,'scanRetirements'|'reserveControl'|'retirementRequest'|'recordCleanupAck'>;readonly gateway:RunnerRetirementGateway};
  readonly exports?:{readonly executions:ExportExecutionStore;readonly outputs:ExportArtifacts;readonly gateway:Pick<RunnerExportGateway,'exportAttempt'|'output'>};
  readonly dataRoot: string;
  readonly outputs: OutputArtifactStore;
  readonly finalizations: OutputFinalizations;
  readonly absences: OutputAbsenceStore;
  readonly observations: Pick<DispatchStore, 'observe'>;
  readonly runs: Pick<RunReader, 'getRun'>;
  /** Shares the installation gateway; this owner cannot close or execute through it. */
  readonly gateway: Pick<RunnerOutputAbsenceGateway, 'output'> & {
    attempt(identity: RunnerAttemptIdentity): Pick<RunnerAttemptClient, 'snapshot'>;
  };
  readonly freeSpaceReserveBytes: number;
  /** Once on fatal failure; must never await this runtime's close. */
  readonly onFailure: (error: unknown) => Promise<void>;
  /** Default250; safe integer25..60000 milliseconds. */
  readonly intervalMs?: number;
}
