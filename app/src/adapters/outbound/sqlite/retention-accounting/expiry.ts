import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import { captureRetentionSnapshot,RETENTION_SNAPSHOT_BYTES,RETENTION_SNAPSHOT_BODY_BYTES,RETENTION_SNAPSHOT_LIFETIME_MS } from '../../../../domain/retention/index.js';
import type { RetentionSnapshot } from '../../../../domain/retention/index.js';
import { completedPageEvidence } from '../retention-progress/observe.js';
import { accounting,requireFact } from './facts.js';
export type RemovalReason='expiry'|'handoff'|'discard';
export function prepareClock(db:DatabaseSync,now:number){
 requireFact(db.isTransaction&&Number.isSafeInteger(now)&&now>=0&&now<=253402300799999);
 const before=accounting(db);const after={...before,clock_ms:Math.max(now,before.clock_ms)};
 const usage=db.prepare('SELECT charged_bytes FROM installation_storage_usage WHERE id=1').get()?.charged_bytes;
 requireFact(typeof usage==='number'&&usage>=before.charged_bytes,'unavailable');return{before,after,usage:[usage,usage] as const};
}
function previewRemoval(snapshot:RetentionSnapshot,clock:number,reason:RemovalReason):boolean{
 if(reason==='expiry')return Date.parse(snapshot.expiresAt)<=clock;if(reason==='discard')return true;
 return snapshot.kind==='retention'&&snapshot.candidates.length===0&&(snapshot.hasMore||snapshot.traversal?.nextWorkspace!=null)&&Date.parse(snapshot.expiresAt)>clock;
}
function completedRemoval(completedAt:unknown,clock:number,reason:RemovalReason):boolean{
 requireFact(typeof completedAt==='string'&&completedAt.length===24,'unavailable');const parsed=Date.parse(completedAt);
 requireFact(Number.isFinite(parsed)&&new Date(parsed).toISOString()===completedAt,'unavailable');
 return reason==='discard'||reason==='expiry'&&clock-parsed>=RETENTION_SNAPSHOT_LIFETIME_MS;
}
function permittedRows(db:DatabaseSync,snapshot:RetentionSnapshot,row:Record<string,unknown>,clock:number,reason:RemovalReason):Map<string,string>|null{
 if(row.state==='preview'){
  requireFact(row.applied===null&&row.completed_at===null,'unavailable');if(!previewRemoval(snapshot,clock,reason))return null;
  requireFact(!db.prepare('SELECT 1 FROM retention_progress WHERE snapshot_id=? LIMIT 1').get(snapshot.id),'unavailable');return new Map();
 }
 if(row.state!=='completed'||!completedRemoval(row.completed_at,clock,reason))return null;
 return completedPageEvidence(db,snapshot,row.applied);
}
export function prepareExpiry(db:DatabaseSync,id:string,now:number,reason:RemovalReason='expiry'){
 const clock=prepareClock(db,now);
 const row=db.prepare(`SELECT state,completed_at,CASE WHEN length(CAST(apply_json AS BLOB))<=2048 THEN apply_json END applied,charged_bytes,
  CASE WHEN length(CAST(body_json AS BLOB))<=32768 THEN body_json END body FROM retention_snapshots WHERE id=?`).get(id);
 if(!row)return null;requireFact(row.charged_bytes===RETENTION_SNAPSHOT_BYTES&&typeof row.body==='string','unavailable');
 const snapshot=captureRetentionSnapshot(JSON.parse(row.body));requireFact(snapshot.id===id&&encodeCanonicalJson(snapshot,RETENTION_SNAPSHOT_BODY_BYTES)===row.body,'unavailable');
 const progress=permittedRows(db,snapshot,row,clock.after.clock_ms,reason);if(!progress)return null;
 requireFact(clock.before.snapshot_count>0&&clock.before.charged_bytes>=RETENTION_SNAPSHOT_BYTES&&clock.usage[0]>=RETENTION_SNAPSHOT_BYTES,'unavailable');
 return{...clock,snapshot,body:row.body,binding:JSON.stringify([row.state,row.applied,RETENTION_SNAPSHOT_BYTES,row.completed_at]),progress,
  usage:[clock.usage[0],clock.usage[0]-RETENTION_SNAPSHOT_BYTES] as const,
  after:{...clock.after,snapshot_count:clock.before.snapshot_count-1,charged_bytes:clock.before.charged_bytes-RETENTION_SNAPSHOT_BYTES}};
}
