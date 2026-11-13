import { requireCleanupControl } from '../cleanup-control/index.js';
import { captureOutputRetirementRequest } from '@beetle/contracts/output-retirement';
import type { RetirementRequest as OutputRetirementRequest } from '@beetle/contracts/output-retirement';
import type { DatabaseSync } from 'node:sqlite';
import type { Run } from '@beetle/contracts/api';
import type { RunKey } from '../../../../ports/runs.js';
import type { OutputDeletionKey } from '../../../../ports/output-deletion-metadata.js';
import { finalEventsReady } from '../output-finalization/index.js';
import { StorageError } from '../protocol.js';
import { captureFacts } from './facts.js';
import { parent,summary,file } from './rows.js';
import { captureDeletionReply } from './replies.js';
/** Read under the existing deletion transaction; no registration or caller proof. */
export function retirementRequest(db:DatabaseSync,runs:{get(key:RunKey):Run},key:OutputDeletionKey):OutputRetirementRequest{
 const row=parent(db,key); requireCleanupControl(db,{runId:row.run_id as string,attemptId:row.attempt_id as string,organizationId:row.organization_id as string,workspaceId:row.workspace_id as string});const progress=summary(db,key);
 if(progress.kind==='unsent'||progress.stage!=='files_absent')throw new StorageError('conflict');
 const facts=captureFacts(db,runs,{request:{scope:key.scope,runId:progress.runId,requestId:progress.requestId,expectedRunVersion:progress.runVersion}});
 if(!facts.retirement||facts.kind!==progress.kind||facts.closureDigest!==row.closure_digest||facts.run.activeAttemptId!==row.attempt_id
  ||facts.versions.length!==progress.fileCount)throw new StorageError('unavailable');
 requireFileReceipts(db,key,progress.fileCount,row.namespace_identity);
 const {binding,closure}=facts.retirement;const a=binding.key.attempt;
 if(!retainedEvents(db,a.attemptId,binding.key.runId,closure.finalAgentSeq))throw new StorageError('unavailable');
 return captureOutputRetirementRequest({version:1,purpose:'performance',...a,journalAuthority:binding.journalAuthority,
  runId:binding.key.runId,deletionId:progress.id,deletionVersion:progress.deletionVersion,closure});
}
function retainedEvents(db:DatabaseSync,attemptId:string,runId:string,end:number):boolean{
 return !!db.prepare(`SELECT 1 FROM execution_records e JOIN event_cursors c ON c.attempt_id=e.attempt_id
  JOIN (SELECT ? AS final_agent_seq) h WHERE e.attempt_id=? AND e.run_id=? AND e.event_pending=0
  AND c.run_id=e.run_id AND c.organization_id=e.organization_id AND c.workspace_id=e.workspace_id
  AND c.intent_digest=e.intent_digest AND c.journal_authority=e.journal_authority AND c.generation=e.acknowledged_generation
  AND (SELECT count(*) FROM run_events WHERE attempt_id=e.attempt_id AND generation=1)=h.final_agent_seq
  AND ${finalEventsReady('h.final_agent_seq')}`).get(end,attemptId,runId);
}
function requireFileReceipts(db:DatabaseSync,key:OutputDeletionKey,count:number,namespace:unknown):void{
 for(let ordinal=0;ordinal<count;ordinal++){
  const fileKey={...key,ordinal};const current=captureDeletionReply({kind:'getOutputDeletionFile',key:fileKey},file(db,fileKey));
  if(!('phase' in current)||current.phase!=='absent'||current.namespaceIdentity!==namespace)throw new StorageError('unavailable');
 }
}
