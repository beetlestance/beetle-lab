import type {OutputDeletionMetadata} from '../../ports/output-deletion-metadata.js';
import type {OutputDeletionStore} from '../../ports/output-deletion.js';
export type DeletionProgress=Pick<OutputDeletionMetadata,'scan'|'getFile'|'recordPlan'|'recordAbsence'>;
export interface OutputDeletionRuntimeOptions {
 readonly metadata:DeletionProgress;
 readonly files:OutputDeletionStore;
 readonly freeSpaceReserveBytes:number;
 readonly intervalMs?:number;
 /** Must not await this child's or its parent's close from the callback. */
 readonly onFailure:(error:unknown)=>Promise<void>;
}
export interface OutputDeletionRuntime {close():Promise<void>}
