import { eligibleNoTaskReceiptBinding,readNoTaskReceipt } from '../no-task-receipts/store.js';
import { noTaskPipelineReply } from '../../retirement-pipeline/no-task-reply.js';
import { originalCounts } from './counts.js';
import { settlementOriginal } from './original.js';
import { prepareRejectedSettlement } from './rejected.js';
import { owner } from '../sql.js';
import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import { captureSettlementRequest,cleanedReplyDigest,settlementRequestDigest } from '@beetle/contracts/output-settlement';
import type { SettlementRequest } from '@beetle/contracts/output-settlement';
import { agentTombstoneDigest,captureAgentTombstone } from '../../settlement-values/index.js';
import { retirementDigest } from '../../retirement-values/index.js';
import { pipelineReply } from '../../retirement-pipeline/reply.js';
import { eligibleRetirement,readRetirementIntent } from '../retirement/index.js';
import { retirementKey } from '../retirement/eligibility.js';
import { readCleanupPlan } from '../cleanup-plans/index.js';
import { readCleanupProgress } from '../cleanup-progress/index.js';
import { readCleanupReceipt } from '../cleanup-receipts/store.js';
import { Failure } from '../sql.js';
function requireFact(value:unknown):asserts value{if(!value)throw new Failure('conflict');}
function closure(db:DatabaseSync,request:SettlementRequest){
 const retirement=request.retirement;const key=retirementKey(retirement);
 const intent=readRetirementIntent(db,key);requireFact(intent);
 const eligible=eligibleRetirement(db,retirement);
 requireFact(encodeCanonicalJson(intent,4096)===encodeCanonicalJson(eligible,4096));
 if(intent.task.state==='none'){
  const binding=eligibleNoTaskReceiptBinding(db,retirement);const receipt=readNoTaskReceipt(db,binding);requireFact(receipt);
  const reply=noTaskPipelineReply(retirement,receipt);requireFact(reply.state==='cleaned'&&cleanedReplyDigest(reply,retirement,retirementDigest)===request.cleanupReplyDigest);
  return{key,reply,noTask:true};
 }
 const plan=readCleanupPlan(db,key);requireFact(plan);
 const progress=readCleanupProgress(db,plan.plan);requireFact(progress?.state==='files_absent');
 const receipt=readCleanupReceipt(db,plan.plan);requireFact(receipt);
 requireFact(receipt.receipt.planIdentity===plan.planIdentity);
 const reply=pipelineReply(retirement,receipt);
 requireFact(reply.state==='cleaned'&&cleanedReplyDigest(reply,retirement,retirementDigest)===request.cleanupReplyDigest);
 return{key,reply,noTask:false};
}
function hold(db:DatabaseSync,request:SettlementRequest){
 const key=request.retirement;
 const row=db.prepare(`SELECT output_bytes,staging_bytes,metadata_bytes FROM disk_holds
  WHERE attempt_id=? AND organization_id=? AND workspace_id=? AND generation=1 AND intent_digest=? AND phase='retained'`)
  .get(key.attemptId,key.organizationId,key.workspaceId,key.intentDigest);
 requireFact(row&&typeof row.output_bytes==='number'&&typeof row.staging_bytes==='number'&&row.metadata_bytes===512);
 return{outputBytes:row.output_bytes as number,stagingBytes:row.staging_bytes as number};
}
/** Must run under the same immediate transaction as the fixed guarded purge. */
export function prepareAgentSettlement(db:DatabaseSync,input:unknown){
 requireFact(db.isTransaction);const request=captureSettlementRequest(input);
 if(owner(db,request.retirement).cleanup_control_version===0)return prepareRejectedSettlement(db,request);
 const{key,reply,noTask}=closure(db,request);
 const{row,offerDigest,charges}=settlementOriginal(db,key);const disk=hold(db,request);
 const tombstone=captureAgentTombstone({version:1,offerDigest,settlementRequestDigest:settlementRequestDigest(request,retirementDigest),
  reply,charges,disk,chargedBytes:4096},request);
 requireFact(row.hold_bytes===512);
 const retainedCounts=originalCounts(db,key.attemptId,{rows:row.spool_rows,bytes:row.spool_bytes});
 for(const table of ['accepted_attempts','admission_queue','reservations','disk_holds','output_retirement_intents'] as const)requireFact(retainedCounts.get(table)===1);
 for(const table of ['task_staging_namespaces','output_cleanup_plans','output_cleanup_progress','output_cleanup_receipts'] as const)requireFact(retainedCounts.get(table)===(noTask?0:1));
 requireFact(retainedCounts.get('output_no_task_cleanup_receipts')===(noTask?1:0));requireFact(retainedCounts.get('rejected_cleanup_controls')===0);
 return{request,tombstone,json:encodeCanonicalJson(tombstone,3584),digest:agentTombstoneDigest(tombstone,request),counts:retainedCounts};
}
