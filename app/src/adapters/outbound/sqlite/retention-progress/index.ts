import { snapshotById } from '../retention-selection/rows.js';
import type { DatabaseSync } from 'node:sqlite';
import type { Run } from '@beetle/contracts/api';
import type { RunKey } from '../../../../ports/runs.js';
import type { RetentionStatus,RetentionStatusKey,RetentionStatusItem } from '../../../../ports/retention.js';
import { transaction } from '../transaction.js';
import { commitRetentionClock,commitRetentionDiscard,observeRetentionCompletion } from '../retention-accounting-guard/index.js';
/** Metadata-only progress; counters and completion come from current authoritative owners. */
export class RetentionProgress {
 constructor(private readonly db:DatabaseSync,private readonly runs:{get(key:RunKey):Run}){}
 discard(key:RetentionStatusKey,now:number){
  return transaction(this.db,()=>{
   const clock=commitRetentionClock(this.db,now);snapshotById(this.db,key.scope,key.id);commitRetentionDiscard(this.db,key.id,clock);
   return Object.freeze({id:key.id,scope:key.scope,refundedLogicalBytes:131072});
  });
 }
 get(key:RetentionStatusKey,now:number):RetentionStatus{
  return transaction(this.db,()=>{
   const clock=commitRetentionClock(this.db,now);const observed=observeRetentionCompletion(this.db,this.runs,key,clock);const snapshot=observed.snapshot;
   const preview:RetentionStatusItem[]=snapshot.candidates.map(member=>({runId:member.id,runVersion:member.version,deletionId:member.deletionId,phase:'preview',
    fileCount:null,preparedCount:null,absentCount:null,error:null,refundedLogicalBytes:0}));
   return{id:snapshot.id,scope:snapshot.scope,state:observed.state,capturedAt:snapshot.capturedAt,expiresAt:snapshot.expiresAt,completedAt:observed.completedAt,
    items:observed.observation?.items??preview,completedCount:observed.observation?.completedCount??0,refundedLogicalBytes:observed.observation?.refundedLogicalBytes??0};
  });
 }
}
