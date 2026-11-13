import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Run } from '@beetle/contracts/api';
import type { RunKey } from '../../../../ports/runs.js';
import { captureRetentionSnapshot,RETENTION_SNAPSHOT_LIFETIME_MS } from '../../../../domain/retention/index.js';
import { transaction } from '../transaction.js';
import { reserveRetentionSnapshot,pruneRetentionSnapshots,retentionBasis } from '../retention-accounting/index.js';
import { requireFact } from '../retention-accounting/facts.js';
import { snapshotById } from '../retention-selection/rows.js';
import { inspectRetentionFact } from '../retention-selection/facts.js';
import type { Header } from '../retention-selection/facts.js';
import { StorageError } from '../protocol.js';
import { captureManualCommand } from './values.js';
type Command=ReturnType<typeof captureManualCommand>;
/** Manual selection shares the positive proof and prepaid immutable Apply owner. */
export class ManualRunDeletionSnapshots {
 constructor(private readonly db:DatabaseSync,private readonly runs:{get(key:RunKey):Run}){}
 preview(input:unknown){
  const command=captureManualCommand(input);const now=Date.parse(command.capturedAt);
  transaction(this.db,()=>pruneRetentionSnapshots(this.db,now));
  return transaction(this.db,()=>this.select(command,now));
 }
 private select(command:Command,now:number){
  const db=this.db;const request=command.request;const scope=request.scope;
  const replay=db.prepare('SELECT id,intent_digest FROM retention_snapshots WHERE organization_id=? AND workspace_id=? AND request_id=?').get(scope.organizationId,scope.workspaceId,request.requestId);
  if(replay){requireFact(replay.intent_digest===command.intentDigest&&typeof replay.id==='string');const stored=snapshotById(db,scope,replay.id).snapshot;
   requireFact(stored.kind==='manual'&&Date.parse(stored.expiresAt)>now);return stored;}
  const header=db.prepare('SELECT id,version,state,outcome,requested_at FROM runs WHERE organization_id=? AND workspace_id=? AND id=?').get(scope.organizationId,scope.workspaceId,request.runId) as unknown as Header|undefined;
  if(!header)throw new StorageError('not_found');requireFact(header.version===request.expectedRunVersion);
  const basis=retentionBasis(db,scope);if(basis.settings.workspace.id!==request.settingsId)throw new StorageError('not_found');requireFact(basis.settings.workspace.version===request.expectedVersion);
  const fact=inspectRetentionFact(db,this.runs,scope,header,request.requestId);
  requireFact(fact.completed&&fact.protection==='none');requireFact(fact.logicalBytes!==null,'unavailable');
  const zero={completedCount:0,logicalBytes:0};const snapshot=captureRetentionSnapshot({version:1,id:command.id,kind:'manual',scope,requestId:request.requestId,intentDigest:command.intentDigest,
   capturedAt:command.capturedAt,expiresAt:new Date(now+RETENTION_SNAPSHOT_LIFETIME_MS).toISOString(),settings:basis.settings,policy:basis.policy,policySource:basis.policySource,epoch:basis.epoch,
   predecessorId:null,before:zero,after:{completedCount:1,logicalBytes:fact.logicalBytes},scanned:1,cursor:null,hasMore:false,
   candidates:[{id:header.id,version:header.version,estimatedBytes:fact.logicalBytes,reason:'manual',deletionId:randomUUID(),requestId:randomUUID()}],exclusions:[]});
  return reserveRetentionSnapshot(db,snapshot,now);
 }
}
