import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson,encodeJson } from '@beetle/contracts';
import { captureCleanupProgress,cleanupProgressFollows,cleanupControl,cleanupDigest } from '../../cleanup-control/index.js';
import type { NativeCleanupPlan,CleanupProgress } from '../../cleanup-control/index.js';
import { eligibleStoredPlan } from '../cleanup-plans/index.js';
import { sourceScope } from '../output-source-input.js';
import { Failure,transaction } from '../sql.js';
import type { CleanupProgressOperation,CleanupProgressValue } from '../cleanup-progress-protocol.js';
import { cleanupProgressOperation } from '../cleanup-progress-protocol.js';
export function readCleanupProgress(db:DatabaseSync,plan:NativeCleanupPlan):CleanupProgress|null{
 const row=db.prepare(`SELECT CASE WHEN length(CAST(progress_json AS BLOB))<=${cleanupControl.progressBytes} THEN progress_json END AS json,plan_identity,encoded_bytes,charged_bytes FROM output_cleanup_progress WHERE attempt_id=?`).get(plan.original.attemptId);
 if(!row)return null;try{
  if(typeof row.json!=='string')throw Error();const progress=captureCleanupProgress(JSON.parse(row.json) as unknown,plan);
  if(encodeCanonicalJson(progress,cleanupControl.progressBytes)!==row.json||progress.planIdentity!==row.plan_identity
   ||row.encoded_bytes!==Buffer.byteLength(row.json)||row.charged_bytes!==Buffer.byteLength(row.json)+512)throw Error();return progress;
 }catch{throw new Failure('unavailable');}
}
function update(db:DatabaseSync,plan:NativeCleanupPlan,next:CleanupProgress):CleanupProgress{
 const prior=readCleanupProgress(db,plan);if(!prior||!cleanupProgressFollows(prior,next))throw new Failure('conflict');
 const json=encodeCanonicalJson(next,cleanupControl.progressBytes);const bytes=Buffer.byteLength(json);
 db.prepare('UPDATE output_cleanup_progress SET progress_json=?,encoded_bytes=?,charged_bytes=? WHERE attempt_id=?').run(json,bytes,bytes+512,plan.original.attemptId);return next;
}
function begin(db:DatabaseSync,plan:NativeCleanupPlan,identity:string):CleanupProgress{
 let prior=readCleanupProgress(db,plan);
 if(!prior){prior=captureCleanupProgress({protocolVersion:1,planIdentity:identity,entryCount:plan.entries.length,removedCount:0,version:1,state:'prepared'},plan);
  const json=encodeCanonicalJson(prior,cleanupControl.progressBytes);const bytes=Buffer.byteLength(json);
  db.prepare('INSERT INTO output_cleanup_progress(attempt_id,plan_identity,progress_json,encoded_bytes,charged_bytes) VALUES(?,?,?,?,?)').run(plan.original.attemptId,identity,json,bytes,bytes+512);
 }
 return prior;
}
function capture(input:CleanupProgressOperation&{id:number}):CleanupProgressOperation{
 const copy=JSON.parse(encodeJson(input,cleanupControl.progressBytes+1024)) as CleanupProgressOperation&{id:number};
 if(!cleanupProgressOperation(copy)||!Number.isSafeInteger(copy.id)||copy.id<=0||!cleanupDigest(copy.planIdentity))throw Error();
 const fields=copy.kind==='cleanupProgressAdvance'?'id,json,key,kind,planIdentity':'id,key,kind,planIdentity';if(Object.keys(copy).sort().join(',')!==fields)throw Error();
 const key=sourceScope(copy.key);if(copy.kind!=='cleanupProgressAdvance')return{kind:copy.kind,key,planIdentity:copy.planIdentity};
 if(typeof copy.json!=='string'||Buffer.byteLength(copy.json)>cleanupControl.progressBytes)throw Error();return{kind:copy.kind,key,planIdentity:copy.planIdentity,json:copy.json};
}
export class CleanupProgressStore{
 constructor(private readonly db:DatabaseSync){}
 execute(input:CleanupProgressOperation&{id:number}):CleanupProgressValue{
  let command:CleanupProgressOperation;try{command=capture(input);}catch{throw new Failure('invalid_input');}
  return transaction(this.db,()=>{
   const stored=eligibleStoredPlan(this.db,command.key,command.planIdentity);let progress:CleanupProgress|null;
   if(command.kind==='cleanupProgressRead')progress=readCleanupProgress(this.db,stored.plan);
   else if(command.kind==='cleanupProgressBegin')progress=begin(this.db,stored.plan,stored.planIdentity);
   else{let next:CleanupProgress;try{next=captureCleanupProgress(JSON.parse(command.json) as unknown,stored.plan);}catch{throw new Failure('invalid_input');}progress=update(this.db,stored.plan,next);}
   return{key:command.key,planIdentity:stored.planIdentity,progress};
  });
 }
}
