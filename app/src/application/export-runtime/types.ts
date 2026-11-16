import type {ExportExecutionStore,ExportArtifacts} from '../../ports/exports.js';
import type {RunnerExportGateway} from '../../ports/export-runner.js';
import type {OutputTransfers} from '../../ports/output-transfer.js';
import type {OutputBinding} from '../../domain/output-owner/index.js';
export interface ExportRuntimeOptions {
 readonly executions:ExportExecutionStore;
 readonly outputs:Pick<ExportArtifacts,'settleAbsence'>;
 readonly gateway:Pick<RunnerExportGateway,'exportAttempt'|'output'>;
 readonly transfers:OutputTransfers<OutputBinding>;
 readonly intervalMs?:number;
 /** Must not await this runtime's close from its own producer. */
 readonly onFailure:(error:unknown)=>Promise<void>;
}
export interface ExportRuntime {
 close():Promise<void>;
}
