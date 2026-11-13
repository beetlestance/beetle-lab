import { encodeCanonicalJson } from '@beetle/contracts';
import { captureOutputRetirementReply } from '@beetle/contracts/output-retirement';
import type { RetirementRequest } from '@beetle/contracts/output-retirement';
import type { DatabaseSync } from 'node:sqlite';
import type { Run } from '@beetle/contracts/api';
import type { RunKey } from '../../../../ports/runs.js';
import type { OutputCleanupAck,OutputCleanupAckState,OutputCleanupAckWrite,OutputDeletionKey } from '../../../../ports/output-deletion-metadata.js';
import { insertCleanupAck } from '../cleanup-ack-guard/index.js';
import { sha256 } from '../input-values.js';
import { StorageError } from '../protocol.js';
import { retirementRequest } from './retirement-request.js';
import { parent } from './rows.js';
import { captureCleanupAck } from './ack-values.js';
type Runs={get(key:RunKey):Run};
function stored(db:DatabaseSync,key:OutputDeletionKey,expected:RetirementRequest):OutputCleanupAck|undefined{
 const row=db.prepare(`SELECT CASE WHEN length(CAST(body_json AS BLOB))<=4096 THEN body_json ELSE NULL END body_json,
  version,reply_digest,logical_bytes FROM backend_output_cleanup_acks WHERE deletion_id=?`).get(key.id);
 if(!row)return undefined;
 try{
  if(typeof row.body_json!=='string')throw Error('Invalid receipt body');
  const reply=captureOutputRetirementReply(JSON.parse(row.body_json) as unknown,expected,sha256);
  if(encodeCanonicalJson(reply,4096)!==row.body_json)throw Error('Noncanonical receipt');
  return captureCleanupAck(key,{version:row.version,reply,replyDigest:row.reply_digest,logicalBytes:row.logical_bytes});
 }catch{throw new StorageError('unavailable');}
}
/** Parent owns the immediate transaction. This stores metadata, not a new IO proof. */
export function recordCleanupAck(db:DatabaseSync,runs:Runs,request:OutputCleanupAckWrite):OutputCleanupAck{
 const expected=retirementRequest(db,runs,request.key);let reply:ReturnType<typeof captureOutputRetirementReply>;
 try{reply=captureOutputRetirementReply(request.reply,expected,sha256);}catch{throw new StorageError('conflict');}
 if(reply.state!=='cleaned')throw new StorageError('conflict');
 const body=encodeCanonicalJson(reply,4096);const digest=sha256(body);const old=stored(db,request.key,expected);
 if(old){if(old.replyDigest!==digest||encodeCanonicalJson(old.reply,4096)!==body)throw new StorageError('conflict');return old;}
 insertCleanupAck(db,{deletionId:request.key.id,body,digest,logicalBytes:Buffer.byteLength(body)+512});
 const result=stored(db,request.key,expected);if(!result)throw new StorageError('unavailable');return result;
}
export function readCleanupAck(db:DatabaseSync,runs:Runs,key:OutputDeletionKey):OutputCleanupAckState{
 parent(db,key);
 if(!db.prepare('SELECT 1 FROM backend_output_cleanup_acks WHERE deletion_id=?').get(key.id))return {kind:'missing'};
 const ack=stored(db,key,retirementRequest(db,runs,key));if(!ack)throw new StorageError('unavailable');return {kind:'stored',ack};
}
