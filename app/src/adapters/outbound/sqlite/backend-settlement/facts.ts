import type { DatabaseSync } from 'node:sqlite';
import type { Run } from '@beetle/contracts/api';
import { captureSettlementRequest,captureSettlementReply,settlementRequestDigest } from '@beetle/contracts/output-settlement';
import type { BackendSettlementWrite } from '../../../../ports/output-settlement-metadata.js';
import type { RunKey } from '../../../../ports/runs.js';
import { settlementProjection } from '../output-deletion/index.js';
import { captureBackendTombstone,backendSettlementCredit,backendTombstoneDigest } from '../settlement-values/index.js';
import { encodeCanonicalJson } from '@beetle/contracts';
import { sha256 } from '../input-values.js';
import { StorageError } from '../protocol.js';
import { purgeOrder } from './purge-order.js';
import type { OriginalIds,PurgeTable } from './purge-order.js';
function requireFact(value:unknown):asserts value {if(!value)throw new StorageError('conflict');}
function counts(db:DatabaseSync,ids:OriginalIds){
 const result=new Map<PurgeTable,number>();
 for(const [table,column,key,maximum] of purgeOrder){
  const count=db.prepare(`SELECT count(*) n FROM (SELECT 1 FROM ${table} WHERE ${column}=? LIMIT ?)`)
   .get(ids[key],maximum+1)?.n;
  requireFact(typeof count==='number'&&Number.isSafeInteger(count)&&count>=0&&count<=maximum);result.set(table,count);
 }
 return result;
}
function agentBinding(facts:ReturnType<typeof settlementProjection>,rows:Map<PurgeTable,number>,write:BackendSettlementWrite){
 let reply=null;let request=null;
 if(facts.retirement){
  requireFact(facts.ack);request=captureSettlementRequest({version:1,retirement:facts.retirement,cleanupReplyDigest:facts.ack.replyDigest});
  try{reply=captureSettlementReply(write.agentReply,request,sha256);}catch{throw new StorageError('conflict');}
  for(const table of ['attempt_output_allocations','execution_records','event_cursors','backend_output_cleanup_acks'] as const)requireFact(rows.get(table)===1);
  requireFact(rows.get('run_events')===facts.retirement.closure.finalAgentSeq);
 }else{
  requireFact(write.agentReply===null);
  for(const table of ['attempt_output_allocations','execution_records','event_cursors','run_events','backend_output_cleanup_acks'] as const)requireFact(rows.get(table)===0);
 }
 return request&&reply?{cleanupReplyDigest:request.cleanupReplyDigest,agentTombstoneDigest:reply.tombstoneDigest,
  settlementRequestDigest:settlementRequestDigest(request,sha256)}:{cleanupReplyDigest:null,agentTombstoneDigest:null,settlementRequestDigest:null};
}
/** Capture before any permit exists. The existing retained projection owns all cleanup evidence. */
export function prepareBackendSettlement(db:DatabaseSync,runs:{get(key:RunKey):Run},write:BackendSettlementWrite){
 requireFact(db.isTransaction);
 const parent=db.prepare('SELECT attempt_id FROM output_deletion_intents WHERE id=? AND run_id=? AND organization_id=? AND workspace_id=?')
  .get(write.key.id,write.key.runId,write.key.scope.organizationId,write.key.scope.workspaceId);
 requireFact(typeof parent?.attempt_id==='string');const ids={attempt:parent.attempt_id,run:write.key.runId,deletion:write.key.id};
 const rows=counts(db,ids);
 for(const table of ['output_deletion_intents','backend_cleanup_controls','attempts','execution_intents','execution_orders','runs'] as const)requireFact(rows.get(table)===1);
 requireFact(db.prepare('SELECT count(*) n FROM (SELECT 1 FROM attempts WHERE run_id=? LIMIT 2)').get(ids.run)?.n===1);
 requireFact(!db.prepare('SELECT 1 FROM export_jobs WHERE attempt_id=? LIMIT 1').get(ids.attempt));
 const order=db.prepare("SELECT queue_order FROM execution_orders WHERE attempt_id=? AND purpose='performance'").get(ids.attempt);
 requireFact(order&&!db.prepare('SELECT 1 FROM export_jobs WHERE queue_order=? LIMIT 1').get(order.queue_order!));
 const facts=settlementProjection(db,runs,write.key);const binding=agentBinding(facts,rows,write);
 const p=facts.progress;const credit={kind:p.kind,retainedPayloadBytes:p.retainedPayloadBytes,metadataBytes:p.metadataBytes,cleanupBytes:65536 as const};
 const tombstone=captureBackendTombstone({version:1,organizationId:p.scope.organizationId,workspaceId:p.scope.workspaceId,runId:p.runId,
  attemptId:ids.attempt,deletionId:p.id,runVersion:p.runVersion,intentDigest:facts.intentDigest,closureDigest:facts.closureDigest,...credit,
  ...binding,refundedBytes:backendSettlementCredit(credit),chargedBytes:2560});
 return{ids,counts:rows,tombstone,json:encodeCanonicalJson(tombstone,2048),digest:backendTombstoneDigest(tombstone)};
}
