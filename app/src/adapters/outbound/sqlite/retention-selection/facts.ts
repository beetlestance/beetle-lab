import type { DatabaseSync } from 'node:sqlite';
import type { Run,WorkspaceScope } from '@beetle/contracts/api';
import type { RunKey } from '../../../../ports/runs.js';
import type { RetentionFact } from '../../../../domain/retention/index.js';
import { inspectOutputDeletionCandidate } from '../output-deletion/index.js';
import { readHistorySummaries } from '../run-history/index.js';
import { StorageError } from '../protocol.js';
import { SemanticError } from '../../../../domain/namespaces/index.js';
export interface Header {readonly id:string;readonly requested_at:string;readonly version:number;readonly state:Run['state'];readonly outcome:Run['outcome']}
function matchHeader(run:Run,header:Header):void{
 if(run.version!==header.version||run.state!==header.state||run.outcome!==header.outcome)throw new StorageError('unavailable');
}
/** One scoped positive metadata proof; no Begin, native call or credit. */
export function inspectRetentionFact(db:DatabaseSync,runs:{get(key:RunKey):Run},scope:WorkspaceScope,header:Header,requestId:string):RetentionFact{
 const completed=['finished','cancelled','errored'].includes(header.state)&&header.outcome!=='pending';
 const base={requestedAt:header.requested_at,completed};
 try{
  const run=runs.get({scope,id:header.id});
  matchHeader(run,header);
  const logicalBytes=readHistorySummaries(db,scope,[run])[0]!.retainedLogicalBytes;
  if(!completed)return{...base,logicalBytes,protection:'none'};
  if(db.prepare('SELECT 1 FROM output_deletion_intents WHERE run_id=? LIMIT 1').get(run.id))return{...base,logicalBytes,protection:'cleanup_in_progress'};
  const eligible=inspectOutputDeletionCandidate(db,runs,{scope,runId:run.id,expectedRunVersion:run.version,requestId});
  if(eligible.logicalBytes!==logicalBytes)throw new StorageError('unavailable');return{...base,logicalBytes,protection:'none'};
 }catch(error){
  if(!(error instanceof StorageError||error instanceof SemanticError))throw error;
  return{...base,logicalBytes:null,protection:'unknown'};
 }
}
