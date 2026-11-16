import type { DatabaseSync } from 'node:sqlite';
import type { Run } from '@beetle/contracts/api';
import type { RunKey } from '../../../../ports/runs.js';
import type { OutputDeletionCommand,OutputDeletionSummary } from '../../../../ports/output-deletion-metadata.js';
import { prepareOutputDeletion } from '../../../../application/output-deletion/index.js';
import { lower,sha256 } from '../input-values.js';
import { StorageError } from '../protocol.js';
import { captureFacts } from './facts.js';
import { captureDeletionReply } from './replies.js';
/** Shared positive intent representation; no inserts, allocation or native authority. */
export function prepareInitialDeletion(db:DatabaseSync,runs:{get(key:RunKey):Run},input:OutputDeletionCommand){
 const command=prepareOutputDeletion(input,sha256);const facts=captureFacts(db,runs,command);const run=facts.run;
 if(db.prepare('SELECT id FROM output_deletion_intents WHERE run_id=?').get(run.id))throw new StorageError('conflict');
 const original={runId:run.id,attemptId:run.activeAttemptId,organizationId:run.scope.organizationId,workspaceId:run.scope.workspaceId};
 const count=facts.versions.length;const id=lower(command.id);const requestId=lower(command.request.requestId);
 const parameters=[id,run.id,run.activeAttemptId,run.scope.organizationId,run.scope.workspaceId,requestId,run.version,
  facts.kind,command.requestedAt,facts.closureDigest,facts.retainedPayloadBytes,facts.metadataBytes,count,count] as const;
 const intentBinding=JSON.stringify([...parameters.slice(0,7),1,1,...parameters.slice(7),null]);
 const files=facts.versions.map((version,ordinal)=>({parameters:[id,run.activeAttemptId,ordinal,version] as const,
  binding:JSON.stringify([id,run.activeAttemptId,ordinal,version,1,null,null,0])}));
 const summary=captureDeletionReply({kind:'beginOutputDeletion',command},{id,scope:run.scope,requestId,runId:run.id,runVersion:run.version,deletionVersion:1,version:1,
  kind:facts.kind,stage:count===0?'files_absent':'pending',fileCount:count,preparedCount:0,absentCount:0,
  retainedPayloadBytes:facts.retainedPayloadBytes,metadataBytes:facts.metadataBytes,requestedAt:command.requestedAt}) as OutputDeletionSummary;
 return{command,original,parameters,intentBinding,files,summary};
}
