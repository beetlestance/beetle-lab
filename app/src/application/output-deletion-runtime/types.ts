import type {RunnerRetirementGateway} from '../../ports/runner-retirement.js';
import type {OutputDeletionMetadata} from '../../ports/output-deletion-metadata.js';
import type {OutputDeletionStore} from '../../ports/output-deletion.js';
export type DeletionProgress=Pick<OutputDeletionMetadata,'scan'|'getFile'|'recordPlan'|'recordAbsence'|'reserveControl'>;
export interface RetirementProgress {
 readonly metadata:Pick<OutputDeletionMetadata,'scanRetirements'|'reserveControl'|'retirementRequest'|'recordCleanupAck'>;
 readonly gateway:RunnerRetirementGateway;
 readonly digest:(value:string)=>string;
}
export interface OutputDeletionRuntimeOptions {
 /** Explicit isolated embedding; production composition supplies retirement instead. */
 readonly fileOnly?:true;
 readonly retirement?:RetirementProgress;
 readonly metadata:DeletionProgress;
 readonly files:OutputDeletionStore;
 readonly freeSpaceReserveBytes:number;
 readonly intervalMs?:number;
 /** Must not await this child's or its parent's close from the callback. */
 readonly onFailure:(error:unknown)=>Promise<void>;
}
export interface OutputDeletionRuntime {close():Promise<void>}
