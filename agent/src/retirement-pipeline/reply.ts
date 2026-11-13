import { captureOutputRetirementReply,outputRetirementDigest } from '@beetle/contracts/output-retirement';
import type { RetirementRequest } from '@beetle/contracts/output-retirement';
import { retirementDigest } from '../retirement-values/index.js';
import type { StoredCleanupReceipt } from '../cleanup-control/index.js';
export function pipelineReply(request:RetirementRequest,stored?:StoredCleanupReceipt){
 const{closure:_closure,...binding}=request;void _closure;
 const base={...binding,retirementVersion:1,requestDigest:outputRetirementDigest(request,retirementDigest)};
 return captureOutputRetirementReply(stored?{...base,state:'cleaned',namespaceIdentity:stored.receipt.namespaceIdentity,
  preparationIdentity:stored.receipt.taskNamespaceIdentity,cleanupReceiptDigest:stored.receiptIdentity}:{...base,state:'pending'},request,retirementDigest);
}
