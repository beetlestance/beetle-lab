import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import type { Run } from '@beetle/contracts/api';
import type { RetentionStatusKey } from '../../../../ports/retention.js';
import type { RunKey } from '../../../../ports/runs.js';
import type { RetentionSnapshot } from '../../../../domain/retention/index.js';
import { transaction } from '../transaction.js';
import { reserveRetentionSnapshot,pruneRetentionSnapshots,retentionBasis } from '../retention-accounting/index.js';
import { commitRetentionHandoff } from '../retention-accounting-guard/index.js';
import { requireFact } from '../retention-accounting/facts.js';
import { StorageError } from '../protocol.js';
import { capturePreviewCommand,cursorSnapshot } from './values.js';
import { snapshotById } from './rows.js';
import { selectWindow } from './window.js';
type Command=ReturnType<typeof capturePreviewCommand>;
/** One immutable workspace page. Root/worker composition owns this metadata service. */
export class WorkspaceRetentionSnapshots {
 constructor(private readonly db:DatabaseSync,private readonly runs:{get(key:RunKey):Run}){}
 get(key:RetentionStatusKey):RetentionSnapshot{return transaction(this.db,()=>snapshotById(this.db,key.scope,key.id).snapshot);}
 preview(input:unknown):RetentionSnapshot{
  const command=capturePreviewCommand(input);const now=Date.parse(command.capturedAt);
  // Separate maintenance commit preserves observed expiry even when selection later refuses.
  transaction(this.db,()=>pruneRetentionSnapshots(this.db,now));
  return transaction(this.db,()=>this.select(command,now));
 }
 private select(command:Command,now:number):RetentionSnapshot{
  const db=this.db;const request=command.request;
  const replay=db.prepare('SELECT id,intent_digest FROM retention_snapshots WHERE organization_id=? AND workspace_id=? AND request_id=?')
   .get(request.scope.organizationId,request.scope.workspaceId,request.requestId);
  if(replay){requireFact(replay.intent_digest===command.intentDigest&&typeof replay.id==='string');const stored=snapshotById(db,request.scope,replay.id).snapshot;
   requireFact(Date.parse(stored.expiresAt)>now);return stored;}
  if(!db.prepare('SELECT 1 FROM workspaces WHERE id=? AND organization_id=?').get(request.scope.workspaceId,request.scope.organizationId))throw new StorageError('not_found');
  const basis=retentionBasis(db,request.scope);if(basis.settings.workspace.id!==request.settingsId)throw new StorageError('not_found');
  requireFact(basis.settings.workspace.version===request.expectedVersion);
  const previous=this.predecessor(command,basis);
  const snapshot=selectWindow(db,this.runs,command,basis,previous);
  if(previous?.candidates.length===0)commitRetentionHandoff(db,previous.id,now);
  return reserveRetentionSnapshot(db,snapshot,now);
 }
 private predecessor(command:Command,basis:ReturnType<typeof retentionBasis>):RetentionSnapshot|null{
  const request=command.request;if(!request.page.cursor)return null;
  const stored=snapshotById(this.db,request.scope,cursorSnapshot(request.page.cursor));const previous=stored.snapshot;
  requireFact(stored.state==='preview'&&previous.kind==='retention'&&previous.hasMore&&Date.parse(previous.expiresAt)>Date.parse(command.capturedAt));
  requireFact(previous.epoch===basis.epoch&&encodeCanonicalJson([previous.settings,previous.policy,previous.policySource],4096)===encodeCanonicalJson([basis.settings,basis.policy,basis.policySource],4096));return previous;
 }
}
export { previewCursor } from './values.js';
