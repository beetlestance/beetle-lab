import type { NoTaskReceipt,NoTaskNativePorts } from '../no-task-receipt/index.js';
import type { CleanupLease } from '../cleanup-access/index.js';
import type { TaskInventoryOperation } from '../task-inventory/index.js';
import type { Journal } from '../journal/index.js';
import type { ProducerRetirement } from '../producer-retirement/index.js';
import type { RuntimeRetirement } from '../runtime-retirement/index.js';
import type { TaskInventory,InventoryPorts } from '../task-inventory/index.js';
import type { NativeRemoval,RemovalPorts } from '../native-removal/index.js';
import type { NativeReceipt } from '../native-receipt/index.js';
import type { RetirementReply } from '@beetle/contracts/output-retirement';
export interface RetirementPipelineOptions{readonly journal:Journal;readonly producer:ProducerRetirement;readonly runtime:RuntimeRetirement;
 readonly inventory:TaskInventory;readonly removal:NativeRemoval;readonly receipt:NativeReceipt;readonly maximumSteps?:number;readonly noTask?:NoTaskReceipt}
export interface PipelineNativePorts{readonly inventory:InventoryPorts;readonly removal:RemovalPorts;readonly noTask?:NoTaskNativePorts}
export interface PipelineWork{readonly result:Promise<RetirementReply>;
 /** Actual issued calls settled, not proof of successful close/drain. Rejects failures. */
 readonly settled:Promise<void>}
export class RetirementPipelineError extends Error{constructor(readonly reason:'invalid_input'|'capacity'|'conflict'|'closed'|'unavailable'){super(`Retirement pipeline ${reason}`);}}

export interface PipelineEntry {uncertain:boolean;access?:CleanupLease;id?:string;digest?:string;work?:PipelineWork;native?:Pick<TaskInventoryOperation,'quiesced'|'close'>}
