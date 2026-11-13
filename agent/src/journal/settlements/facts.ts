import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson,RUNNER_MAXIMUM_OFFER_BYTES } from '@beetle/contracts';
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
import { owner,quotaUsed,Failure } from '../sql.js';
import { purgeOrder } from './purge-order.js';
function requireFact(value:unknown):asserts value{if(!value)throw new Failure('conflict');}
function closure(db:DatabaseSync,request:SettlementRequest){
 const retirement=request.retirement;const key=retirementKey(retirement);
 const intent=readRetirementIntent(db,key);requireFact(intent);
 const eligible=eligibleRetirement(db,retirement);
 requireFact(encodeCanonicalJson(intent,4096)===encodeCanonicalJson(eligible,4096));
 const plan=readCleanupPlan(db,key);requireFact(plan);
 const progress=readCleanupProgress(db,plan.plan);requireFact(progress?.state==='files_absent');
 const receipt=readCleanupReceipt(db,plan.plan);requireFact(receipt);
 requireFact(receipt.receipt.planIdentity===plan.planIdentity);
 const reply=pipelineReply(retirement,receipt);
 requireFact(reply.state==='cleaned'&&cleanedReplyDigest(reply,retirement,retirementDigest)===request.cleanupReplyDigest);
 return{key,reply};
}
function hold(db:DatabaseSync,request:SettlementRequest){
 const key=request.retirement;
 const row=db.prepare(`SELECT output_bytes,staging_bytes,metadata_bytes FROM disk_holds
  WHERE attempt_id=? AND organization_id=? AND workspace_id=? AND generation=1 AND intent_digest=? AND phase='retained'`)
  .get(key.attemptId,key.organizationId,key.workspaceId,key.intentDigest);
 requireFact(row&&typeof row.output_bytes==='number'&&typeof row.staging_bytes==='number'&&row.metadata_bytes===512);
 return{outputBytes:row.output_bytes as number,stagingBytes:row.staging_bytes as number};
}
function counts(db:DatabaseSync,attemptId:string,spoolRows:number){
 const rows=new Map<typeof purgeOrder[number],number>();
 for(const table of purgeOrder){
  const value=db.prepare(`SELECT count(*) n FROM (SELECT 1 FROM ${table} WHERE attempt_id=? LIMIT ?)`)
   .get(attemptId,table==='event_spool'?65537:2)?.n;
  requireFact(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=(table==='event_spool'?65536:1));rows.set(table,value);
 }
 for(const table of ['accepted_attempts','admission_queue','reservations','disk_holds','task_staging_namespaces',
  'output_retirement_intents','output_cleanup_plans','output_cleanup_progress','output_cleanup_receipts'] as const)requireFact(rows.get(table)===1);
 requireFact(rows.get('event_spool')===spoolRows);return rows;
}
/** Must run under the same immediate transaction as the fixed guarded purge. */
export function prepareAgentSettlement(db:DatabaseSync,input:unknown){
 requireFact(db.isTransaction);const request=captureSettlementRequest(input);const{key,reply}=closure(db,request);
 const row=owner(db,key);requireFact(row.execution_purpose==='performance'&&quotaUsed(row)<=row.quota_bytes);
 requireFact(!db.prepare('SELECT 1 FROM export_assignments WHERE attempt_id=?').get(key.attemptId));
 const disk=hold(db,request);
 const text=db.prepare(`SELECT CASE WHEN length(CAST(canonical_json AS BLOB))<=? THEN canonical_json END json
  FROM accepted_attempts WHERE attempt_id=?`).get(RUNNER_MAXIMUM_OFFER_BYTES,key.attemptId)?.json;
 requireFact(typeof text==='string');
 const tombstone=captureAgentTombstone({version:1,offerDigest:retirementDigest(text),settlementRequestDigest:settlementRequestDigest(request,retirementDigest),
  reply,charges:{spoolBytes:row.spool_bytes,snapshotBytes:row.snapshot_bytes,checkpointBytes:row.checkpoint_bytes,holdBytes:row.hold_bytes,
   collectionBytes:row.collection_bytes,sourceBytes:row.source_bytes,deliveryBytes:row.delivery_bytes,absenceBytes:row.absence_bytes,
   cleanupControlBytes:row.cleanup_control_bytes},disk,chargedBytes:4096},request);
 requireFact(row.hold_bytes===512);
 const retainedCounts=counts(db,key.attemptId,row.spool_rows);
 const spool=db.prepare('SELECT coalesce(sum(charged_bytes),0) n FROM (SELECT charged_bytes FROM event_spool WHERE attempt_id=? LIMIT 65537)').get(key.attemptId)?.n;
 requireFact(spool===row.spool_bytes);
 return{request,tombstone,json:encodeCanonicalJson(tombstone,3584),digest:agentTombstoneDigest(tombstone,request),counts:retainedCounts};
}
