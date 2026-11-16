import { encodeCanonicalJson } from '@beetle/contracts';
import type { DatabaseSync } from 'node:sqlite';
import type { Run } from '@beetle/contracts/api';
import type { RunKey } from '../../../../ports/runs.js';
import type { RetentionStatusItem } from '../../../../ports/retention.js';
import { captureRetentionProgress } from '../../../../domain/retention/index.js';
import type { RetentionSnapshot } from '../../../../domain/retention/index.js';
import { readRetiredOutput } from '../backend-settlement/index.js';
import { observeOutputDeletion } from '../output-deletion/index.js';
import { captureAppliedSnapshot } from '../retention-apply/values.js';
import { requireFact } from '../retention-accounting/facts.js';
type Member=RetentionSnapshot['candidates'][number];
function blocked(member:Member):RetentionStatusItem{
 return{runId:member.id,runVersion:member.version,deletionId:member.deletionId,phase:'blocked',fileCount:null,preparedCount:null,absentCount:null,error:'unavailable',refundedLogicalBytes:0};
}
function settled(db:DatabaseSync,snapshot:RetentionSnapshot,member:Member,fileCount:number):RetentionStatusItem|null{
 const proof=readRetiredOutput(db,{scope:snapshot.scope,id:member.deletionId,runId:member.id});if(!proof)return null;
 requireFact(proof.tombstone.runVersion===member.version&&proof.result.refundedBytes===member.estimatedBytes-2560&&proof.result.chargedBytes===2560,'unavailable');
 return{runId:member.id,runVersion:member.version,deletionId:member.deletionId,phase:'settled',fileCount,preparedCount:fileCount,absentCount:fileCount,error:null,refundedLogicalBytes:proof.result.refundedBytes};
}
function initialProgress(row:Record<string,unknown>|undefined,member:Member,ordinal:number){
 requireFact(row&&row.ordinal===ordinal&&row.run_id===member.id&&row.deletion_id===member.deletionId&&row.request_id===member.requestId&&typeof row.body==='string','unavailable');
 const initial=captureRetentionProgress(JSON.parse(row.body));requireFact(encodeCanonicalJson(initial,256)===row.body,'unavailable');requireFact(initial.phase==='admitted'&&initial.error===null&&initial.preparedCount===0&&initial.absentCount===0,'unavailable');return initial;
}
function phase(observed:ReturnType<typeof observeOutputDeletion>):RetentionStatusItem['phase']{
 if(observed.progress.stage!=='files_absent')return 'backend_files';
 return observed.progress.kind==='unsent'||observed.ack.kind==='stored'?'settling':'agent_cleanup';
}
function observeMember(db:DatabaseSync,runs:{get(key:RunKey):Run},snapshot:RetentionSnapshot,member:Member,position:{readonly row:Record<string,unknown>|undefined;readonly ordinal:number}):RetentionStatusItem{
 try{
  const initial=initialProgress(position.row,member,position.ordinal);const done=settled(db,snapshot,member,initial.fileCount);if(done)return done;
  const observed=observeOutputDeletion(db,runs,{scope:snapshot.scope,id:member.deletionId,runId:member.id});const p=observed.progress;
  requireFact(p.runVersion===member.version&&p.requestId===member.requestId&&p.fileCount===initial.fileCount,'unavailable');

  return{runId:member.id,runVersion:member.version,deletionId:member.deletionId,phase:phase(observed),fileCount:p.fileCount,preparedCount:p.preparedCount,absentCount:p.absentCount,error:null,refundedLogicalBytes:0};
 }catch{return blocked(member);}
}
function appliedRows(db:DatabaseSync,snapshot:RetentionSnapshot,applyBody:unknown){
 requireFact(db.isTransaction&&typeof applyBody==='string','unavailable');captureAppliedSnapshot(JSON.parse(applyBody),snapshot);
 const rows=db.prepare(`SELECT ordinal,run_id,deletion_id,request_id,issue_json,CASE WHEN length(CAST(body_json AS BLOB))<=256 THEN body_json END body
  FROM retention_progress WHERE snapshot_id=? ORDER BY ordinal LIMIT 101`).all(snapshot.id);
 requireFact(rows.length===snapshot.candidates.length,'unavailable');return rows;
}
/** Every completion comes from the actual permanent settlement owner, never stored phase text. */
export function observeAppliedPage(db:DatabaseSync,runs:{get(key:RunKey):Run},snapshot:RetentionSnapshot,applyBody:unknown){
 const rows=appliedRows(db,snapshot,applyBody);const items=snapshot.candidates.map((member,index)=>observeMember(db,runs,snapshot,member,{row:rows[index],ordinal:index}));
 const completedCount=items.filter(item=>item.phase==='settled').length;const refundedLogicalBytes=items.reduce((n,item)=>n+item.refundedLogicalBytes,0);
 requireFact(Number.isSafeInteger(refundedLogicalBytes),'unavailable');return{items,completedCount,refundedLogicalBytes,complete:completedCount===snapshot.candidates.length};
}
/** Expiry/discard reads only immutable permanent proofs; absent/malformed evidence is protected. */
export function completedPageEvidence(db:DatabaseSync,snapshot:RetentionSnapshot,applyBody:unknown){
 try{
  const rows=appliedRows(db,snapshot,applyBody);const bindings=new Map<string,string>();
  for(let ordinal=0;ordinal<rows.length;ordinal++){
   const member=snapshot.candidates[ordinal];requireFact(member,'unavailable');const row=rows[ordinal]!;const initial=initialProgress(row,member,ordinal);
   if(!settled(db,snapshot,member,initial.fileCount))return null;requireFact(typeof row.body==='string','unavailable');
   bindings.set(JSON.stringify([snapshot.id,ordinal,row.run_id,row.deletion_id,row.request_id,row.issue_json]),row.body);
  }return bindings;
 }catch{return null;}
}
