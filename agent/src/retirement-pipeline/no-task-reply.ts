import { captureOutputRetirementReply,outputRetirementDigest } from '@beetle/contracts/output-retirement';
import type { RetirementRequest } from '@beetle/contracts/output-retirement';
import type { StoredNoTaskReceipt } from '../no-task-receipt-values/index.js';
import { captureStoredNoTaskReceipt } from '../no-task-receipt-values/index.js';
import { retirementDigest } from '../retirement-values/index.js';
/** Reply commitment only. The worker/native owners separately establish the receipt's authority. */
export function noTaskPipelineReply(request:RetirementRequest,input:StoredNoTaskReceipt){
 const receipt=input.receipt;const stored=captureStoredNoTaskReceipt(input,{request,namespaceIdentity:receipt.namespaceIdentity,
  taskName:receipt.taskName,daemonId:receipt.daemonId,root:receipt.root,markerDigest:receipt.markerDigest});
 const{closure:_closure,...binding}=request;void _closure;
 return captureOutputRetirementReply({...binding,retirementVersion:1,requestDigest:outputRetirementDigest(request,retirementDigest),
  state:'cleaned',namespaceIdentity:stored.receipt.namespaceIdentity,preparationIdentity:stored.receipt.preparationIdentity,
  cleanupReceiptDigest:stored.receiptIdentity},request,retirementDigest);
}
