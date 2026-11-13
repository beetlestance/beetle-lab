import { snapshotById } from '../retention-selection/rows.js';
import type { DatabaseSync } from 'node:sqlite';
import type { Run } from '@beetle/contracts/api';
import type { RunKey } from '../../../../ports/runs.js';
import type { RetentionBatchList,RetentionStatus,RetentionStatusKey,RetentionStatusItem } from '../../../../ports/retention.js';
import { StorageError } from '../protocol.js';
import { requireFact } from '../retention-accounting/facts.js';
import type { WorkspaceScope } from '@beetle/contracts/api';
import { transaction } from '../transaction.js';
import { commitRetentionClock,commitRetentionDiscard,observeRetentionCompletion } from '../retention-accounting-guard/index.js';
/** Metadata-only progress; counters and completion come from current authoritative owners. */
export class RetentionProgress {
 constructor(private readonly db:DatabaseSync,private readonly runs:{get(key:RunKey):Run}){}
 list(scope:WorkspaceScope):RetentionBatchList{
  return transaction(this.db,()=>{
   if(!this.db.prepare('SELECT 1 FROM workspaces WHERE organization_id=? AND id=?').get(scope.organizationId,scope.workspaceId))throw new StorageError('not_found');
   const rows=this.db.prepare('SELECT id FROM retention_snapshots WHERE organization_id=? AND workspace_id=? ORDER BY captured_at DESC,id DESC LIMIT 8').all(scope.organizationId,scope.workspaceId);
   const items=rows.map(row=>{
    requireFact(typeof row.id==='string','unavailable');const stored=snapshotById(this.db,scope,row.id);const snapshot=stored.snapshot;
    requireFact(['preview','applied','completed'].includes(stored.state as string),'unavailable');
    return{id:snapshot.id,scope:snapshot.scope,kind:snapshot.kind,state:stored.state as RetentionStatus['state'],capturedAt:snapshot.capturedAt,expiresAt:snapshot.expiresAt,completedAt:stored.completedAt as string|null,candidateCount:snapshot.candidates.length};
   });return{scope,items};
  });
 }
 discard(key:RetentionStatusKey,now:number){
  return transaction(this.db,()=>{
   const clock=commitRetentionClock(this.db,now);snapshotById(this.db,key.scope,key.id);commitRetentionDiscard(this.db,key.id,clock);
   return Object.freeze({id:key.id,scope:key.scope,refundedLogicalBytes:131072 as const});
  });
 }
 get(key:RetentionStatusKey,now:number):RetentionStatus{
  return transaction(this.db,()=>{
   const clock=commitRetentionClock(this.db,now);const observed=observeRetentionCompletion(this.db,this.runs,key,clock);const snapshot=observed.snapshot;
   const preview:RetentionStatusItem[]=snapshot.candidates.map(member=>({runId:member.id,runVersion:member.version,deletionId:member.deletionId,phase:'preview',
    fileCount:null,preparedCount:null,absentCount:null,error:null,refundedLogicalBytes:0}));
   return{id:snapshot.id,scope:snapshot.scope,kind:snapshot.kind,estimatedLogicalBytes:snapshot.candidates.reduce((n,member)=>n+member.estimatedBytes,0),state:observed.state,capturedAt:snapshot.capturedAt,expiresAt:snapshot.expiresAt,completedAt:observed.completedAt,
    items:observed.observation?.items??preview,completedCount:observed.observation?.completedCount??0,refundedLogicalBytes:observed.observation?.refundedLogicalBytes??0};
  });
 }
}
