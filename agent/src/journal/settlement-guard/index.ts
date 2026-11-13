import { noTaskReceiptActive } from '../no-task-receipts/store.js';
import { rejectedFundingActive } from '../rejected-controls/guard.js';
import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import { prepareAgentSettlement } from '../settlements/facts.js';
import { transferCounters } from '../settlements/counters.js';
import { readStoredSettlement,settlementReply } from '../settlements/rows.js';
import { captureSettlementRequest } from '@beetle/contracts/output-settlement';
import { Failure } from '../sql.js';
import { purgeOrder } from '../settlements/purge-order.js';
type Prepared=ReturnType<typeof prepareAgentSettlement>;
interface Permit{readonly prepared:Prepared;readonly counters:ReturnType<typeof transferCounters>;phase:'insert'|'purge';table?:typeof purgeOrder[number]}
const permits=new WeakMap<DatabaseSync,Permit>();
function same(left:unknown,right:unknown):boolean{return encodeCanonicalJson(left,512)===encodeCanonicalJson(right,512);}
/** Non-deterministic process-local authorization. No caller can open a raw SQL permit. */
export function registerSettlementGuard(db:DatabaseSync):void{
 db.function('agent_settlement_active',()=>permits.has(db)||rejectedFundingActive(db)||noTaskReceiptActive(db)?1:0);
 db.function('agent_settlement_insert_allowed',(attempt,json,digest)=>{
  const permit=permits.get(db);return permit?.phase==='insert'&&attempt===permit.prepared.request.retirement.attemptId
   &&json===permit.prepared.json&&digest===permit.prepared.digest?1:0;
 });
 db.function('agent_settlement_delete_allowed',(attempt,table)=>{
  const permit=permits.get(db);return permit?.phase==='purge'&&table===permit.table
   &&attempt===permit.prepared.request.retirement.attemptId?1:0;
 });
 db.function('agent_settlement_replay_stats_allowed',(oldCount,oldBytes,newCount,newBytes)=>{
  const permit=permits.get(db);return permit?.phase==='insert'&&same([oldCount,oldBytes],permit.counters.replayBefore)
   &&same([newCount,newBytes],permit.counters.replayAfter)?1:0;
 });
 db.function('agent_settlement_hold_stats_allowed',(before,after)=>{
  const permit=permits.get(db);return permit?.phase==='purge'&&permit.table==='disk_holds'
   &&before===JSON.stringify(permit.counters.holdBefore)&&after===JSON.stringify(permit.counters.holdAfter)?1:0;
 });
}
function purge(db:DatabaseSync,permit:Permit):void{
 const id=permit.prepared.request.retirement.attemptId;permit.phase='purge';
 for(const table of purgeOrder){
  permit.table=table;const changed=db.prepare(`DELETE FROM ${table} WHERE attempt_id=?`).run(id).changes;
  if(changed!==permit.prepared.counts.get(table))throw new Failure('conflict');
  if(db.prepare(`SELECT 1 FROM ${table} WHERE attempt_id=? LIMIT 1`).get(id))throw new Failure('conflict');
 }
}
/** Fixed no-callback transaction body; caller owns the same immediate transaction. */
export function commitAgentSettlement(db:DatabaseSync,input:unknown){
 if(!db.isTransaction||db.prepare('SELECT agent_settlement_active() active').get()?.active!==0)throw new Failure('conflict');const request=captureSettlementRequest(input);
 const replay=readStoredSettlement(db,request);if(replay)return settlementReply(replay,request);
 const prepared=prepareAgentSettlement(db,request);const counters=transferCounters(db,prepared.tombstone.disk);
 const permit:Permit={prepared,counters,phase:'insert'};permits.set(db,permit);
 try{
  const key=request.retirement;
  const changed=db.prepare(`INSERT INTO retired_attempts(attempt_id,organization_id,workspace_id,settlement_request_digest,
   tombstone_digest,tombstone_json,charged_bytes) VALUES(?,?,?,?,?,?,4096)`).run(key.attemptId,key.organizationId,key.workspaceId,
   prepared.tombstone.settlementRequestDigest,prepared.digest,prepared.json).changes;
  if(changed!==1)throw new Failure('conflict');purge(db,permit);
  const after=transferAfter(db);if(!same(after.hold,counters.holdAfter)||!same(after.replay,counters.replayAfter))throw new Failure('unavailable');
  const stored=readStoredSettlement(db,request);if(!stored)throw new Failure('unavailable');return settlementReply(stored,request);
 }finally{permits.delete(db);}
}
function transferAfter(db:DatabaseSync){
 const hold=db.prepare(`SELECT held_count,held_output_bytes,held_staging_bytes,retained_output_bytes,retained_staging_bytes FROM disk_retention_stats WHERE id=1`).get();
 const replay=db.prepare('SELECT original_count,charged_bytes FROM agent_replay_storage WHERE id=1').get();
 return{hold:[hold?.held_count,hold?.held_output_bytes,hold?.held_staging_bytes,hold?.retained_output_bytes,hold?.retained_staging_bytes],
  replay:[replay?.original_count,replay?.charged_bytes]};
}
