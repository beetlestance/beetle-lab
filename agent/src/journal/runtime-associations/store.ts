import type {DatabaseSync} from 'node:sqlite';
import {encodeCanonicalJson,encodeJson} from '@beetle/contracts';
import {bindRuntimeAssociation,captureRuntimeAssociation,runtimeAssociationBytes} from '../../runtime-association/index.js';
import type {RuntimeAssociation} from '../../runtime-association/index.js';
import type {Scope} from '../../admission/index.js';
import {readRetirementIntent,eligibleRetirement} from '../retirement/index.js';
import {sourceScope} from '../output-source-input.js';
import {Failure,transaction} from '../sql.js';
import {runtimeAssociationOperation} from '../runtime-association-protocol.js';
import type {RuntimeAssociationOperation,RuntimeAssociationValue} from '../runtime-association-protocol.js';
export function associationKey(value:RuntimeAssociation):Scope{
 const {organizationId,workspaceId,attemptId,generation}=value.original;return {organizationId,workspaceId,attemptId,generation};
}
function intent(db:DatabaseSync,key:Scope){
 const value=readRetirementIntent(db,key);if(!value)throw new Failure('conflict');
 const eligible=eligibleRetirement(db,value.request);
 if(encodeCanonicalJson(eligible,4096)!==encodeCanonicalJson(value,4096))throw new Failure('conflict');return value;
}
function read(db:DatabaseSync,key:Scope):RuntimeAssociation|null{
 const current=intent(db,key);const row=db.prepare(`SELECT CASE WHEN length(CAST(a.association_json AS BLOB))<=1536 THEN a.association_json END AS json,a.encoded_bytes,a.charged_bytes,
 runtime_association_matches(a.association_json,r.intent_json,q.reservation_json,n.intent_json,t.intent_json) valid
 FROM runtime_cleanup_associations a JOIN output_retirement_intents r ON r.attempt_id=a.attempt_id
 JOIN reservations q ON q.attempt_id=a.attempt_id JOIN installed_staging_namespace n ON n.id=1
 JOIN task_staging_namespaces t ON t.attempt_id=a.attempt_id WHERE a.attempt_id=?`).get(key.attemptId);if(!row)return null;
 try{
  if(row.valid!==1||typeof row.json!=='string')throw Error('Invalid association');const value=bindRuntimeAssociation(JSON.parse(row.json) as unknown,current);
  const json=encodeCanonicalJson(value,runtimeAssociationBytes);
  if(json!==row.json||row.encoded_bytes!==Buffer.byteLength(json)||row.charged_bytes!==Buffer.byteLength(json)+512)throw Error('Invalid association');return value;
 }catch{throw new Failure('unavailable');}
}
function commit(db:DatabaseSync,value:RuntimeAssociation):RuntimeAssociation{
 const key=associationKey(value);bindRuntimeAssociation(value,intent(db,key));const previous=read(db,key);
 const json=encodeCanonicalJson(value,runtimeAssociationBytes);
 if(previous){if(encodeCanonicalJson(previous,runtimeAssociationBytes)!==json)throw new Failure('conflict');return previous;}
 const bytes=Buffer.byteLength(json);db.prepare('INSERT INTO runtime_cleanup_associations(attempt_id,association_json,encoded_bytes,charged_bytes) VALUES(?,?,?,?)').run(key.attemptId,json,bytes,bytes+512);return value;
}
function command(input:RuntimeAssociationOperation&{id:number}):RuntimeAssociationOperation{
 const copy=JSON.parse(encodeJson(input,4096)) as RuntimeAssociationOperation&{id:number};
 if(!runtimeAssociationOperation(copy)||!Number.isSafeInteger(copy.id)||copy.id<1)throw Error('Invalid command');
 if(copy.kind==='runtimeAssociationRead'){
  if(Object.keys(copy).sort().join(',')!=='id,key,kind')throw Error('Invalid fields');return {kind:copy.kind,key:sourceScope(copy.key)};
 }
 if(Object.keys(copy).sort().join(',')!=='id,json,kind'||typeof copy.json!=='string'||Buffer.byteLength(copy.json)>runtimeAssociationBytes)throw Error('Invalid fields');
 return {kind:copy.kind,json:encodeCanonicalJson(captureRuntimeAssociation(JSON.parse(copy.json) as unknown),runtimeAssociationBytes)};
}
export class RuntimeAssociationStore{
 constructor(private readonly db:DatabaseSync){}
 execute(input:RuntimeAssociationOperation&{id:number}):RuntimeAssociationValue{
  let value:RuntimeAssociationOperation;try{value=command(input);}catch{throw new Failure('invalid_input');}
  return transaction(this.db,()=>{
   if(value.kind==='runtimeAssociationRead')return {key:value.key,association:read(this.db,value.key)};
   const association=captureRuntimeAssociation(JSON.parse(value.json) as unknown);return {key:associationKey(association),association:commit(this.db,association)};
  });
 }
}
