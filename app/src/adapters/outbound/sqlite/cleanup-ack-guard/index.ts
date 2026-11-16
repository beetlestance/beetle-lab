import type { DatabaseSync } from 'node:sqlite';
import { StorageError } from '../protocol.js';
export interface AckPermit {readonly deletionId:string;readonly body:string;readonly digest:string;readonly logicalBytes:number}
const registered=new WeakSet<DatabaseSync>();const active=new WeakMap<DatabaseSync,Readonly<AckPermit>>();
/** Trusted metadata transaction only. SQL has no way to create this context. */
export function registerCleanupAckValidation(db:DatabaseSync):void{
 if(registered.has(db))return;
 db.function('backend_cleanup_ack_authorized',{deterministic:false},(id,body,digest,bytes)=>{
  const permit=active.get(db);
  return permit&&id===permit.deletionId&&body===permit.body&&digest===permit.digest&&bytes===permit.logicalBytes?1:0;
 });registered.add(db);
}
function capture(input:AckPermit):Readonly<AckPermit>{
 const {deletionId,body,digest,logicalBytes}=input;
 if(typeof body!=='string'||body.length>4096||Buffer.byteLength(body)>4096||logicalBytes!==Buffer.byteLength(body)+512)throw new StorageError('invalid_input');
 if(typeof deletionId!=='string'||!/^[0-9a-f-]{36}$/.test(deletionId)||typeof digest!=='string'||!/^[0-9a-f]{64}$/.test(digest))throw new StorageError('invalid_input');
 return Object.freeze({deletionId,body,digest,logicalBytes});
}
/** One fixed synchronous INSERT; no callback, await or permit escapes this window. */
export function insertCleanupAck(db:DatabaseSync,input:AckPermit):void{
 if(!registered.has(db))throw new StorageError('unavailable');
 if(!db.isTransaction||active.has(db))throw new StorageError('conflict');
 const permit=capture(input);active.set(db,permit);
 try{
  const result=db.prepare(`INSERT INTO backend_output_cleanup_acks(deletion_id,version,body_json,reply_digest,logical_bytes)
   VALUES(?,1,?,?,?)`).run(permit.deletionId,permit.body,permit.digest,permit.logicalBytes);
  if(result.changes!==1)throw new StorageError('unavailable');
 }finally{active.delete(db);}
}
