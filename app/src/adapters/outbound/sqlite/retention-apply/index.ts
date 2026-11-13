import type { DatabaseSync } from 'node:sqlite';
import type { Run,RetentionApplyReceipt } from '@beetle/contracts/api';
import type { RunKey } from '../../../../ports/runs.js';
import { transaction } from '../transaction.js';
import { pruneRetentionSnapshots } from '../retention-accounting/index.js';
import { commitWorkspaceRetentionApply } from '../retention-accounting-guard/index.js';
import { snapshotById } from '../retention-selection/rows.js';
import { requireFact } from '../retention-accounting/facts.js';
import { captureApplyCommand,captureAppliedSnapshot } from './values.js';
import { StorageError } from '../protocol.js';
/** Positive admission only; existing cleanup driver performs all native work afterwards. */
export class WorkspaceRetentionApplies {
 constructor(private readonly db:DatabaseSync,private readonly runs:{get(key:RunKey):Run}){}
 apply(input:unknown):RetentionApplyReceipt{
  const command=captureApplyCommand(input);transaction(this.db,()=>pruneRetentionSnapshots(this.db,Date.parse(command.appliedAt)));
  return transaction(this.db,()=>{
   const stored=snapshotById(this.db,command.request.scope,command.request.snapshotId);
   const applied=this.db.prepare('SELECT apply_json FROM retention_snapshots WHERE id=?').get(stored.snapshot.id)?.apply_json;
   if(stored.state==='applied'){
    let original;try{requireFact(typeof applied==='string','unavailable');original=captureAppliedSnapshot(JSON.parse(applied),stored.snapshot);}catch{throw new StorageError('unavailable');}
    requireFact(original.requestId===command.request.requestId&&original.intentDigest===command.intentDigest);return original.receipt;
   }
   return commitWorkspaceRetentionApply(this.db,this.runs,command);
  });
 }
}
