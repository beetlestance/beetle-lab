import type { DatabaseSync } from 'node:sqlite';
import type { Run } from '@beetle/contracts/api';
import type { RunKey } from '../../../../ports/runs.js';
import type { BackendSettlementWrite } from '../../../../ports/output-settlement-metadata.js';
import { StorageError } from '../protocol.js';
import { prepareBackendSettlement } from '../backend-settlement/facts.js';
import { purgeOrder } from '../backend-settlement/purge-order.js';
type Prepared=ReturnType<typeof prepareBackendSettlement>;
interface Frame {
 readonly prepared:Prepared;phase:'insert'|'purge'|'usage'|'replay';table?:string;
 readonly usage:readonly [number,number];readonly replay:readonly [string,string];
}
const active=new WeakMap<DatabaseSync,Frame>();const registered=new WeakSet<DatabaseSync>();const poisoned=new WeakSet<DatabaseSync>();
function requireFact(value:unknown):asserts value {if(!value)throw new StorageError('conflict');}
export function assertSettlementConnection(db:DatabaseSync):void {if(poisoned.has(db))throw new StorageError('unavailable');}
/** No public permit setter, callback, or asynchronous authorization window. */
export function registerBackendSettlement(db:DatabaseSync):void{
 if(registered.has(db))return;
 db.function('backend_settlement_active',{deterministic:false},()=>active.has(db)?1:0);
 db.function('backend_settlement_delete',{deterministic:false},(table,key)=>{
  const frame=active.get(db);const item=purgeOrder.find(value=>value[0]===table);
  return frame?.phase==='purge'&&frame.table===table&&item&&frame.prepared.ids[item[2]]===key?1:0;
 });
 db.function('backend_settlement_insert',{deterministic:false},(run,attempt,deletion,json,digest)=>{
  const f=active.get(db);return f?.phase==='insert'&&run===f.prepared.ids.run&&attempt===f.prepared.ids.attempt
   &&deletion===f.prepared.ids.deletion&&json===f.prepared.json&&digest===f.prepared.digest?1:0;
 });
 db.function('backend_settlement_counter',{deterministic:false},(kind,before,after)=>{
  const f=active.get(db);if(!f)return 0;
  if(kind==='usage')return f.phase==='usage'&&before===JSON.stringify([1,f.usage[0]])&&after===JSON.stringify([1,f.usage[1]])?1:0;
  return kind==='replay'&&f.phase==='replay'&&before===f.replay[0]&&after===f.replay[1]?1:0;
 });registered.add(db);
}
function frame(db:DatabaseSync,prepared:Prepared):Frame{
 const usage=db.prepare('SELECT charged_bytes FROM installation_storage_usage WHERE id=1').get()?.charged_bytes;
 const replay=db.prepare('SELECT original_count,charged_bytes FROM backend_replay_storage WHERE id=1').get();
 requireFact(typeof usage==='number'&&Number.isSafeInteger(usage)&&usage>=prepared.tombstone.refundedBytes+2560);
 requireFact(typeof replay?.original_count==='number'&&typeof replay.charged_bytes==='number'
  &&Number.isSafeInteger(replay.original_count+1)&&Number.isSafeInteger(replay.charged_bytes+2560)
  &&replay.charged_bytes===replay.original_count*2560);
 return{prepared,phase:'insert',usage:[usage,usage-prepared.tombstone.refundedBytes],
  replay:[JSON.stringify([1,replay.original_count,replay.charged_bytes]),JSON.stringify([1,replay.original_count+1,replay.charged_bytes+2560])]};
}
/** Caller owns the standalone deferred-FK transaction through COMMIT or ROLLBACK. */
export function commitBackendSettlement(db:DatabaseSync,runs:{get(key:RunKey):Run},write:BackendSettlementWrite){
 assertSettlementConnection(db);requireFact(registered.has(db)&&db.isTransaction&&!active.has(db));
 const prepared=prepareBackendSettlement(db,runs,write);const f=frame(db,prepared);active.set(db,f);
 try{
  requireFact(db.prepare(`INSERT INTO backend_retired_runs(run_id,attempt_id,deletion_id,organization_id,workspace_id,tombstone_json,tombstone_digest,charged_bytes)
   VALUES(?,?,?,?,?,?,?,2560)`).run(prepared.ids.run,prepared.ids.attempt,prepared.ids.deletion,prepared.tombstone.organizationId,
   prepared.tombstone.workspaceId,prepared.json,prepared.digest).changes===1);
  f.phase='purge';
  for(const [table,column,key] of purgeOrder){
   f.table=table;requireFact(db.prepare(`DELETE FROM ${table} WHERE ${column}=?`).run(prepared.ids[key]).changes===prepared.counts.get(table));
   requireFact(!db.prepare(`SELECT 1 FROM ${table} WHERE ${column}=? LIMIT 1`).get(prepared.ids[key]));
  }
  delete f.table;f.phase='usage';
  requireFact(db.prepare('UPDATE installation_storage_usage SET charged_bytes=? WHERE id=1 AND charged_bytes=?').run(f.usage[1],f.usage[0]).changes===1);
  f.phase='replay';
  requireFact(db.prepare('UPDATE backend_replay_storage SET original_count=original_count+1,charged_bytes=charged_bytes+2560 WHERE id=1').run().changes===1);
  return prepared;
 }finally{active.delete(db);}
}
/** Failed rollback/restoration poisons every later Store command, even if native close fails. */
export function poisonSettlementConnection(db:DatabaseSync):never {
 if(poisoned.has(db))throw new StorageError('unavailable');
 poisoned.add(db);try{db.close();}catch{throw new StorageError('unavailable');}throw new StorageError('unavailable');
}
