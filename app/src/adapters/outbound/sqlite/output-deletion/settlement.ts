import type { DatabaseSync } from 'node:sqlite';
import type { Run } from '@beetle/contracts/api';
import type { RunKey } from '../../../../ports/runs.js';
import type { OutputDeletionKey } from '../../../../ports/output-deletion-metadata.js';
import { requireCleanupControl } from '../cleanup-control/index.js';
import { StorageError } from '../protocol.js';
import { captureFacts } from './facts.js';
import { retirementRequest } from './retirement-request.js';
import { readCleanupAck } from './acks.js';
import { parent,summary } from './rows.js';
/** Authoritative retained projection, in the caller's immediate metadata transaction. */
export function settlementProjection(db:DatabaseSync,runs:{get(key:RunKey):Run},key:OutputDeletionKey){
 if(!db.isTransaction)throw new StorageError('conflict');
 const row=parent(db,key);const progress=summary(db,key);
 requireCleanupControl(db,{attemptId:String(row.attempt_id),runId:String(row.run_id),organizationId:String(row.organization_id),workspaceId:String(row.workspace_id)});
 const facts=captureFacts(db,runs,{request:{scope:key.scope,runId:key.runId,requestId:progress.requestId,expectedRunVersion:progress.runVersion}});
 if(progress.stage!=='files_absent')throw new StorageError('conflict');
 const expected={attempt_id:facts.run.activeAttemptId,kind:facts.kind,closure_digest:facts.closureDigest,
  retained_payload_bytes:facts.retainedPayloadBytes,metadata_bytes:facts.metadataBytes,file_count:facts.versions.length};
 if(!Object.entries(expected).every(([field,value])=>row[field]===value))throw new StorageError('conflict');
 const attempt=db.prepare('SELECT intent_digest FROM attempts WHERE id=?').get(facts.run.activeAttemptId);
 if(typeof attempt?.intent_digest!=='string')throw new StorageError('conflict');
 if(facts.kind==='unsent'){
  if(db.prepare('SELECT 1 FROM backend_output_cleanup_acks WHERE deletion_id=?').get(key.id))throw new StorageError('conflict');
  return{progress,intentDigest:attempt.intent_digest,closureDigest:null,retirement:null,ack:null};
 }
 const retirement=retirementRequest(db,runs,key);const ack=readCleanupAck(db,runs,key);
 if(ack.kind!=='stored')throw new StorageError('conflict');
 return{progress,intentDigest:attempt.intent_digest,closureDigest:facts.closureDigest,retirement,ack:ack.ack};
}
