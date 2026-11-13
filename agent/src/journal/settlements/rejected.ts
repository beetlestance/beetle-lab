import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import { cleanedReplyDigest,settlementRequestDigest } from '@beetle/contracts/output-settlement';
import type { SettlementRequest } from '@beetle/contracts/output-settlement';
import { captureAgentTombstone,agentTombstoneDigest } from '../../settlement-values/index.js';
import { retirementDigest } from '../../retirement-values/index.js';
import { noTaskPipelineReply } from '../../retirement-pipeline/no-task-reply.js';
import { eligibleNoTaskReceiptBinding,readNoTaskReceipt } from '../no-task-receipts/store.js';
import { rejectedCounters } from '../rejected-controls/capacity.js';
import { originalCounts } from './counts.js';
import { settlementOriginal } from './original.js';
import { Failure,quotaUsed } from '../sql.js';
function requireFact(value:unknown):asserts value{if(!value)throw new Failure('conflict');}
/** Positive funded no-task receipt only. No released reservation, hold or prepared roles are fabricated. */
export function prepareRejectedSettlement(db:DatabaseSync,request:SettlementRequest){
 requireFact(db.isTransaction);const expected=eligibleNoTaskReceiptBinding(db,request.retirement);
 const receipt=readNoTaskReceipt(db,expected);requireFact(receipt);const reply=noTaskPipelineReply(request.retirement,receipt);
 requireFact(reply.state==='cleaned'&&cleanedReplyDigest(reply,request.retirement,retirementDigest)===request.cleanupReplyDigest);
 const original=settlementOriginal(db,request.retirement);const{row,charges,offerDigest}=original;
 requireFact(row.quota_bytes-quotaUsed(row)>=16384&&rejectedCounters(db)[0]>=1);
 const counts=originalCounts(db,row.attempt_id,{rows:row.spool_rows,bytes:row.spool_bytes});
 for(const table of ['accepted_attempts','output_absence_closures','output_retirement_intents','rejected_cleanup_controls','rejected_cleanup_receipts'] as const)requireFact(counts.get(table)===1);
 for(const table of ['reservations','disk_holds','task_staging_namespaces','runtime_cleanup_associations','output_cleanup_plans','output_cleanup_progress',
  'output_cleanup_receipts','output_sources','output_delivery_closures','output_collection_intents'] as const)requireFact(counts.get(table)===0);
 const tombstone=captureAgentTombstone({version:2,offerDigest,settlementRequestDigest:settlementRequestDigest(request,retirementDigest),reply,charges,
  funding:{kind:'rejected_control',reservedBytes:16384},disk:{outputBytes:0,stagingBytes:0},chargedBytes:4096},request);
 return{request,tombstone,json:encodeCanonicalJson(tombstone,3584),digest:agentTombstoneDigest(tombstone,request),counts};
}
