import { encodeCanonicalJson,encodeJson } from '@beetle/contracts';
import { captureNativeDirectory } from '../cleanup-control/index.js';
import type { NativeDirectoryFact } from '../cleanup-control/index.js';
import { rejectedControlValue } from '../rejected-cleanup-values/index.js';
import { retirementDigest } from '../retirement-values/index.js';
export interface NoTaskReceiptBinding {
 readonly request:unknown;readonly namespaceIdentity:string;readonly taskName:string;readonly daemonId:string;
 readonly root:NativeDirectoryFact;readonly markerDigest:string;
}
export interface NoTaskReceipt {
 readonly version:1;readonly state:'files_absent';readonly retirementRequestDigest:string;readonly namespaceIdentity:string;
 readonly taskName:string;readonly daemonId:string;readonly root:NativeDirectoryFact;readonly markerDigest:string;readonly preparationIdentity:string;
}
export interface StoredNoTaskReceipt {readonly receipt:NoTaskReceipt;readonly receiptIdentity:string}
export const NO_TASK_RECEIPT_BYTES=2048;
function identity(binding:NoTaskReceiptBinding){
 const control=rejectedControlValue(binding);const root=captureNativeDirectory(binding.root);
 if(!/^[A-Za-z0-9:._-]{1,128}$/.test(binding.daemonId)||!/^[a-f0-9]{64}$/.test(binding.markerDigest))throw Error('Invalid no-task identity');
 return{namespaceIdentity:control.namespaceIdentity,taskName:control.taskName,daemonId:binding.daemonId,root,markerDigest:binding.markerDigest};
}
/** Closed metadata identity; native absence and prepaid authority require separate owners. */
export function makeNoTaskReceipt(binding:NoTaskReceiptBinding):NoTaskReceipt{
 const native=identity(binding);const control=rejectedControlValue(binding);
 const preparationIdentity=retirementDigest('beetle-lab.no-task-preparation.v1\n'+encodeCanonicalJson(native,1536));
 const receipt={version:1 as const,state:'files_absent' as const,retirementRequestDigest:control.requestDigest,...native,preparationIdentity};
 encodeCanonicalJson(receipt,NO_TASK_RECEIPT_BYTES);return Object.freeze(receipt);
}
export function captureNoTaskReceipt(input:unknown,binding:NoTaskReceiptBinding):NoTaskReceipt{
 const expected=makeNoTaskReceipt(binding);const copy:unknown=JSON.parse(encodeJson(input,NO_TASK_RECEIPT_BYTES));
 if(encodeCanonicalJson(copy,NO_TASK_RECEIPT_BYTES)!==encodeCanonicalJson(expected,NO_TASK_RECEIPT_BYTES))throw Error('Invalid no-task receipt');
 return expected;
}
export function noTaskReceiptDigest(receipt:NoTaskReceipt):string{
 return retirementDigest('beetle-lab.no-task-receipt.v1\n'+encodeCanonicalJson(receipt,NO_TASK_RECEIPT_BYTES));
}
export function captureStoredNoTaskReceipt(input:unknown,binding:NoTaskReceiptBinding):StoredNoTaskReceipt{
 const copy:unknown=JSON.parse(encodeJson(input,NO_TASK_RECEIPT_BYTES+256));
 if(!copy||typeof copy!=='object'||Array.isArray(copy)||Object.keys(copy).sort().join(',')!=='receipt,receiptIdentity')throw Error('Invalid no-task stored receipt');
 const row=copy as Record<string,unknown>;const receipt=captureNoTaskReceipt(row.receipt,binding);const receiptIdentity=noTaskReceiptDigest(receipt);
 if(row.receiptIdentity!==receiptIdentity)throw Error('Invalid no-task receipt digest');return Object.freeze({receipt,receiptIdentity});
}
