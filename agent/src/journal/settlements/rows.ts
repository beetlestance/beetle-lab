import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import { captureOutputRetirementRequest } from '@beetle/contracts/output-retirement';
import { captureSettlementRequest,cleanedReplyDigest,captureSettlementReply,settlementRequestDigest } from '@beetle/contracts/output-settlement';
import type { SettlementRequest } from '@beetle/contracts/output-settlement';
import { captureAgentTombstone,agentTombstoneDigest } from '../../settlement-values/index.js';
import type { AgentSettlementTombstone } from '../../settlement-values/index.js';
import { retirementDigest } from '../../retirement-values/index.js';
import { Failure } from '../sql.js';
export interface StoredSettlement{readonly tombstone:AgentSettlementTombstone;readonly digest:string}
function raw(db:DatabaseSync,attemptId:string){
 return db.prepare(`SELECT CASE WHEN length(CAST(tombstone_json AS BLOB))<=3584 THEN tombstone_json END json,
  tombstone_digest,settlement_request_digest,organization_id,workspace_id,attempt_id,charged_bytes
  FROM retired_attempts WHERE attempt_id=?`).get(attemptId);
}
function capture(row:NonNullable<ReturnType<typeof raw>>,request:SettlementRequest):StoredSettlement{
 try{
  if(typeof row.json!=='string')throw Error();const tombstone=captureAgentTombstone(JSON.parse(row.json) as unknown,request);
  const key=tombstone.reply;const digest=agentTombstoneDigest(tombstone,request);
  if(row.json!==encodeCanonicalJson(tombstone,3584)||row.tombstone_digest!==digest||row.charged_bytes!==4096
   ||row.settlement_request_digest!==tombstone.settlementRequestDigest||row.attempt_id!==key.attemptId
   ||row.organization_id!==key.organizationId||row.workspace_id!==key.workspaceId)throw Error();return{tombstone,digest};
 }catch{throw new Failure('conflict');}
}
export function readStoredSettlement(db:DatabaseSync,input:unknown):StoredSettlement|null{
 const request=captureSettlementRequest(input);const row=raw(db,request.retirement.attemptId);return row?capture(row,request):null;
}
export function settlementReply(stored:StoredSettlement,request:SettlementRequest){
 return captureSettlementReply({version:1,state:'settled',requestDigest:settlementRequestDigest(request,retirementDigest),
  cleanupReplyDigest:request.cleanupReplyDigest,tombstoneDigest:stored.digest,chargedBytes:4096},request,retirementDigest);
}
/** Exact retirement replay remains independent of every purged original row. */
export function readRetiredReply(db:DatabaseSync,input:unknown){
 const request=captureOutputRetirementRequest(input);
 const row=raw(db,request.attemptId);if(!row)return null;
 try{
  if(typeof row.json!=='string')throw Error();const body=JSON.parse(row.json) as {reply:unknown};
  const release=captureSettlementRequest({version:1,retirement:request,cleanupReplyDigest:cleanedReplyDigest(body.reply,request,retirementDigest)});
  return capture(row,release).tombstone.reply;
 }catch{throw new Failure('conflict');}
}
/** Fence before any fresh acceptance/refusal/cancellation side effect. */
export function assertOfferNotRetired(db:DatabaseSync,attemptId:string):void{
 if(db.prepare('SELECT 1 FROM retired_attempts WHERE attempt_id=?').get(attemptId))throw new Failure('conflict');
}
