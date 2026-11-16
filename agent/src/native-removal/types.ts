import type { CleanupProgress,NativeCleanupPlan } from '../cleanup-control/index.js';
import type { InventoryInstallation } from '../task-inventory/index.js';
import type { NativeDirectoryFact } from '../cleanup-control/index.js';
import type { Operation } from '../backends/docker/index.js';
import type { OutputCollectionReason } from '../collection/output/index.js';
export interface NativeStepInput{readonly directory:string;readonly root:NativeDirectoryFact;readonly installation:InventoryInstallation;
 readonly plan:NativeCleanupPlan;readonly progress:CleanupProgress;readonly operation:Operation;prepareCleaning?():Promise<CleanupProgress>;check():void}
export interface NativeStep{readonly result:Promise<{readonly ok:true;readonly progress:CleanupProgress}|{readonly ok:false;readonly reason:OutputCollectionReason}>;
 readonly quiesced:Promise<void>;close():Promise<void>}

export type NativeStepState=NativeStepInput&{readonly allowMissing:boolean};
