import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import { captureRetentionSnapshot,RETENTION_SNAPSHOT_BYTES,RETENTION_SNAPSHOT_BODY_BYTES } from '../../../../domain/retention/index.js';
import { accounting,requireFact } from './facts.js';
export function prepareClock(db:DatabaseSync,now:number){
 requireFact(db.isTransaction&&Number.isSafeInteger(now)&&now>=0&&now<=253402300799999);
 const before=accounting(db);const after={...before,clock_ms:Math.max(now,before.clock_ms)};
 const usage=db.prepare('SELECT charged_bytes FROM installation_storage_usage WHERE id=1').get()?.charged_bytes;
 requireFact(typeof usage==='number'&&usage>=before.charged_bytes,'unavailable');return{before,after,usage:[usage,usage] as const};
}
function removable(snapshot:ReturnType<typeof captureRetentionSnapshot>,clock:number,reason:'expiry'|'handoff'):boolean{
 if(reason==='expiry')return Date.parse(snapshot.expiresAt)<=clock;
 return snapshot.kind==='retention'&&snapshot.candidates.length===0&&snapshot.hasMore&&Date.parse(snapshot.expiresAt)>clock;
}
export function prepareExpiry(db:DatabaseSync,id:string,now:number,reason:'expiry'|'handoff'='expiry'){
 const clock=prepareClock(db,now);
 const row=db.prepare(`SELECT state,apply_json,charged_bytes,CASE WHEN length(CAST(body_json AS BLOB))<=32768 THEN body_json END body
  FROM retention_snapshots WHERE id=?`).get(id);
 if(!row||row.state!=='preview')return null;
 requireFact(row.apply_json===null&&row.charged_bytes===RETENTION_SNAPSHOT_BYTES&&typeof row.body==='string','unavailable');
 const snapshot=captureRetentionSnapshot(JSON.parse(row.body));
 requireFact(snapshot.id===id&&encodeCanonicalJson(snapshot,RETENTION_SNAPSHOT_BODY_BYTES)===row.body,'unavailable');
 if(!removable(snapshot,clock.after.clock_ms,reason))return null;
 requireFact(!db.prepare('SELECT 1 FROM retention_progress WHERE snapshot_id=? LIMIT 1').get(id),'unavailable');
 requireFact(clock.before.snapshot_count>0&&clock.before.charged_bytes>=RETENTION_SNAPSHOT_BYTES&&clock.usage[0]>=RETENTION_SNAPSHOT_BYTES,'unavailable');
 return{...clock,snapshot,body:row.body,binding:JSON.stringify(['preview',null,RETENTION_SNAPSHOT_BYTES]),
  usage:[clock.usage[0],clock.usage[0]-RETENTION_SNAPSHOT_BYTES] as const,
  after:{...clock.after,snapshot_count:clock.before.snapshot_count-1,charged_bytes:clock.before.charged_bytes-RETENTION_SNAPSHOT_BYTES}};
}
