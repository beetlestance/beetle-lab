import type { DatabaseSync } from 'node:sqlite';
import { prepareReservation,requireFact } from '../retention-accounting/facts.js';
import { prepareClock,prepareExpiry } from '../retention-accounting/expiry.js';
type Prepared=ReturnType<typeof prepareReservation>;
interface ReservationFrame {readonly kind:'reserve';readonly prepared:Prepared;phase:'epoch'|'snapshot'|'usage'|'storage'}
interface ExpiryFrame {readonly kind:'expiry';readonly prepared:NonNullable<ReturnType<typeof prepareExpiry>>;phase:'delete'|'usage'|'storage'}
interface ClockFrame {readonly kind:'clock';readonly prepared:ReturnType<typeof prepareClock>;phase:'storage'}
type Frame=ReservationFrame|ExpiryFrame|ClockFrame;
const frames=new WeakMap<DatabaseSync,Frame>();const registered=new WeakSet<DatabaseSync>();
function tuple(value:Prepared['before']){return JSON.stringify([1,value.epoch_count,value.snapshot_count,value.charged_bytes,value.clock_ms]);}
interface Insert {readonly kind:unknown;readonly organization:unknown;readonly workspace:unknown;readonly id:unknown;readonly body:unknown}
function epochAllowed(f:ReservationFrame,input:Insert):number{
 return f.phase==='epoch'&&f.prepared.newEpoch&&input.id===f.prepared.snapshot.scope.workspaceId&&input.body===null?1:0;
}
function insertAllowed(db:DatabaseSync,input:Insert):number{
 const f=frames.get(db);if(f?.kind!=='reserve')return 0;const s=f.prepared.snapshot;
 if(input.organization!==s.scope.organizationId||input.workspace!==s.scope.workspaceId)return 0;
 if(input.kind==='epoch')return epochAllowed(f,input);
 return input.kind==='snapshot'&&f.phase==='snapshot'&&input.id===s.id&&input.body===f.prepared.body?1:0;
}
function counterAllowed(db:DatabaseSync,kind:unknown,before:unknown,after:unknown):number{
 const f=frames.get(db);if(!f)return 0;
 if(kind==='usage')return f.phase==='usage'&&before===JSON.stringify([1,f.prepared.usage[0]])&&after===JSON.stringify([1,f.prepared.usage[1]])?1:0;
 return kind==='storage'&&f.phase==='storage'&&before===tuple(f.prepared.before)&&after===tuple(f.prepared.after)?1:0;
}
/** SQL can inspect exact writes but cannot create a reservation frame. */
export function registerRetentionAccounting(db:DatabaseSync):void{
 if(registered.has(db))return;
 db.function('retention_metadata_active',{deterministic:false},()=>frames.has(db)?1:0);
 db.function('retention_insert_allowed',{deterministic:false},(kind,organization,workspace,id,body)=>insertAllowed(db,{kind,organization,workspace,id,body}));
 db.function('retention_delete_allowed',{deterministic:false},(kind,id,body,binding)=>deleteAllowed(db,{kind,id,body,binding}));
 db.function('retention_counter_allowed',{deterministic:false},(kind,before,after)=>counterAllowed(db,kind,before,after));
 registered.add(db);
}
/** Fixed synchronous reservation only. Caller owns the immediate transaction/rollback. */
export function commitRetentionReservation(db:DatabaseSync,input:unknown,now:number){
 requireFact(registered.has(db)&&db.isTransaction&&!frames.has(db));
 requireFact(db.prepare('SELECT backend_settlement_active() n').get()?.n===0);
 const prepared=prepareReservation(db,input,now);const f:ReservationFrame={kind:'reserve',prepared,phase:'epoch'};frames.set(db,f);
 try{
  const s=prepared.snapshot;
  if(prepared.newEpoch)requireFact(db.prepare('INSERT INTO retention_workspace_epochs(workspace_id,organization_id,epoch,charged_bytes) VALUES(?,?,1,512)').run(s.scope.workspaceId,s.scope.organizationId).changes===1);
  f.phase='snapshot';
  requireFact(db.prepare(`INSERT INTO retention_snapshots(id,organization_id,workspace_id,request_id,intent_digest,captured_at,expires_at,epoch,body_json,state,charged_bytes)
   VALUES(?,?,?,?,?,?,?,?,?,'preview',131072)`).run(s.id,s.scope.organizationId,s.scope.workspaceId,s.requestId,s.intentDigest,s.capturedAt,s.expiresAt,s.epoch,prepared.body).changes===1);
  f.phase='usage';requireFact(db.prepare('UPDATE installation_storage_usage SET charged_bytes=? WHERE id=1 AND charged_bytes=?').run(prepared.usage[1],prepared.usage[0]).changes===1);
  f.phase='storage';const a=prepared.after;const b=prepared.before;
  requireFact(db.prepare(`UPDATE retention_storage SET epoch_count=?,snapshot_count=?,charged_bytes=?,clock_ms=? WHERE id=1 AND epoch_count=? AND snapshot_count=? AND charged_bytes=? AND clock_ms=?`)
   .run(a.epoch_count,a.snapshot_count,a.charged_bytes,a.clock_ms,b.epoch_count,b.snapshot_count,b.charged_bytes,b.clock_ms).changes===1);
  requireFact(db.prepare('SELECT charged_bytes FROM installation_storage_usage WHERE id=1').get()?.charged_bytes===prepared.usage[1]);
  return s;
 }finally{frames.delete(db);}
}

interface Removal {readonly kind:unknown;readonly id:unknown;readonly body:unknown;readonly binding:unknown}
function deleteAllowed(db:DatabaseSync,input:Removal):number{
 const f=frames.get(db);if(f?.kind!=='expiry')return 0;const p=f.prepared;
 return f.phase==='delete'&&input.kind==='snapshot'&&input.id===p.snapshot.id&&input.body===p.body&&input.binding===p.binding?1:0;
}
function requireIdle(db:DatabaseSync):void{
 requireFact(registered.has(db)&&db.isTransaction&&!frames.has(db));requireFact(db.prepare('SELECT backend_settlement_active() n').get()?.n===0);
}
function writeCounters(db:DatabaseSync,f:ExpiryFrame|ClockFrame):void{
 if(f.kind==='expiry'){
  f.phase='usage';requireFact(db.prepare('UPDATE installation_storage_usage SET charged_bytes=? WHERE id=1 AND charged_bytes=?').run(f.prepared.usage[1],f.prepared.usage[0]).changes===1);
 }
 f.phase='storage';const a=f.prepared.after;const b=f.prepared.before;
 requireFact(db.prepare('UPDATE retention_storage SET epoch_count=?,snapshot_count=?,charged_bytes=?,clock_ms=? WHERE id=1 AND epoch_count=? AND snapshot_count=? AND charged_bytes=? AND clock_ms=?')
  .run(a.epoch_count,a.snapshot_count,a.charged_bytes,a.clock_ms,b.epoch_count,b.snapshot_count,b.charged_bytes,b.clock_ms).changes===1);
}
/** Observed maintenance time commits even when no page is old enough; caller owns transaction. */
export function commitRetentionClock(db:DatabaseSync,now:number):number{
 requireIdle(db);const prepared=prepareClock(db,now);if(prepared.after.clock_ms===prepared.before.clock_ms)return prepared.after.clock_ms;
 const f:ClockFrame={kind:'clock',prepared,phase:'storage'};frames.set(db,f);
 try{writeCounters(db,f);return prepared.after.clock_ms;}finally{frames.delete(db);}
}
/** Expire only an exact, unapplied preview. Applied pages always remain protected here. */
function removeRetentionPage(db:DatabaseSync,id:string,now:number,reason:'expiry'|'handoff'):boolean{
 requireIdle(db);const prepared=prepareExpiry(db,id,now,reason);if(!prepared)return false;
 const f:ExpiryFrame={kind:'expiry',prepared,phase:'delete'};frames.set(db,f);
 try{
  requireFact(db.prepare('DELETE FROM retention_snapshots WHERE id=?').run(prepared.snapshot.id).changes===1);
  requireFact(!db.prepare('SELECT 1 FROM retention_snapshots WHERE id=?').get(prepared.snapshot.id));writeCounters(db,f);return true;
 }finally{frames.delete(db);}
}

export function commitRetentionExpiry(db:DatabaseSync,id:string,now:number):boolean{return removeRetentionPage(db,id,now,'expiry');}
/** Explicit continuation may consume an empty preview; it never drops candidate/work membership. */
export function commitRetentionHandoff(db:DatabaseSync,id:string,now:number):void{requireFact(removeRetentionPage(db,id,now,'handoff'));}
