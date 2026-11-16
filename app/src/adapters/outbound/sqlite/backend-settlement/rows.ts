import type {RunHistoryJob,RetiredHistoryJob} from '../../../../ports/run-history.js';
import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import type { BackendSettlementWrite,BackendSettlementResult } from '../../../../ports/output-settlement-metadata.js';
import type { OutputDeletionKey } from '../../../../ports/output-deletion-metadata.js';
import { captureBackendTombstone,backendTombstoneDigest } from '../settlement-values/index.js';
import { StorageError } from '../protocol.js';
/** Closed persisted scalar reply; no old row or native IO is required after compaction. */
export function storedSettlement(db:DatabaseSync,key:OutputDeletionKey){
 const row=db.prepare(`SELECT run_id,attempt_id,deletion_id,organization_id,workspace_id,charged_bytes,tombstone_digest,
  CASE WHEN length(CAST(tombstone_json AS BLOB))<=2048 THEN tombstone_json END json FROM backend_retired_runs WHERE run_id=?`).get(key.runId);
 if(!row)return null;
 if(!Object.entries({run_id:key.runId,deletion_id:key.id,organization_id:key.scope.organizationId,workspace_id:key.scope.workspaceId})
  .every(([field,value])=>row[field]===value))throw new StorageError('conflict');
 try{
  if(typeof row.json!=='string')throw Error();const tombstone=captureBackendTombstone(JSON.parse(row.json) as unknown);
  const digest=backendTombstoneDigest(tombstone);
  const expected={json:encodeCanonicalJson(tombstone,2048),tombstone_digest:digest,charged_bytes:2560,run_id:tombstone.runId,
   attempt_id:tombstone.attemptId,deletion_id:tombstone.deletionId,organization_id:tombstone.organizationId,workspace_id:tombstone.workspaceId};
  if(!Object.entries(expected).every(([field,value])=>row[field]===value))throw Error();
  const result:BackendSettlementResult={version:1,key,attemptId:tombstone.attemptId,kind:tombstone.kind,
   refundedBytes:tombstone.refundedBytes,chargedBytes:2560,tombstoneDigest:digest};return{tombstone,result};
 }catch{throw new StorageError('unavailable');}
}
export function replaySettlement(db:DatabaseSync,write:BackendSettlementWrite):BackendSettlementResult|null{
 const stored=storedSettlement(db,write.key);if(!stored)return null;const {tombstone:t,result}=stored;
 if(t.kind==='unsent'){if(write.agentReply!==null)throw new StorageError('conflict');return result;}
 const raw=write.agentReply;
 // Full request binding was established at first commit. Persisted hashes own exact reply replay.
 if(!raw)throw new StorageError('conflict');
 const expected={version:1,state:'settled',chargedBytes:4096,requestDigest:t.settlementRequestDigest,
  cleanupReplyDigest:t.cleanupReplyDigest,tombstoneDigest:t.agentTombstoneDigest};
 if(!Object.entries(expected).every(([field,value])=>Reflect.get(raw,field)===value))throw new StorageError('conflict');
 return result;
}

/** Scope/original-bound stale derivative job proof; no accounting or native authority. */
export function retiredHistoryJob(db:DatabaseSync,job:RunHistoryJob):RetiredHistoryJob|null{
 const row=db.prepare('SELECT deletion_id FROM backend_retired_runs WHERE run_id=? AND attempt_id=? AND organization_id=? AND workspace_id=?')
  .get(job.id,job.attemptId,job.scope.organizationId,job.scope.workspaceId);
 if(!row)return null;if(typeof row.deletion_id!=='string')throw new StorageError('unavailable');
 const stored=storedSettlement(db,{scope:job.scope,id:row.deletion_id,runId:job.id});
 if(!stored||stored.tombstone.attemptId!==job.attemptId)throw new StorageError('unavailable');
 return{state:'retired',id:job.id,scope:job.scope,attemptId:job.attemptId};
}
