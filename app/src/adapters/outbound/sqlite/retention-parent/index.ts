import type { DatabaseSync } from 'node:sqlite';
import type { Run } from '@beetle/contracts/api';
import type { RunKey } from '../../../../ports/runs.js';
import type { ParentRetentionPage } from '../../../../ports/retention.js';
import type { RetentionSnapshot } from '../../../../domain/retention/index.js';
import { captureRetentionSnapshot } from '../../../../domain/retention/index.js';
import { transaction } from '../transaction.js';
import { reserveRetentionSnapshot,pruneRetentionSnapshots,retentionBasis } from '../retention-accounting/index.js';
import { commitRetentionHandoff } from '../retention-accounting-guard/index.js';
import { requireFact } from '../retention-accounting/facts.js';
import { selectWindow } from '../retention-selection/window.js';
import { previewCursor } from '../retention-selection/values.js';
import { natural,uuid } from '../output-deletion/values.js';
import { StorageError } from '../protocol.js';
import { captureParentCommand } from './values.js';
import { parentPin } from './rows.js';
import { parentWindow } from './window.js';
import { replayParent,previousParent,parentSnapshotPin } from './facts.js';
type Command=ReturnType<typeof captureParentCommand>;
function page(snapshot:RetentionSnapshot):ParentRetentionPage{
 const context=snapshot.traversal;requireFact(context);const pin=parentSnapshotPin(snapshot,context.scope);
 return{scope:context.scope,requestId:snapshot.requestId,settingsId:pin.id,settingsVersion:pin.version,capturedAt:snapshot.capturedAt,coverage:'live_partial',durable:true,
  workspace:snapshot,nextCursor:snapshot.hasMore||context.nextWorkspace!==null?previewCursor(snapshot.id):null};
}
/** A bounded live scan; the existing charged snapshot owns all durable parent context. */
export class ParentRetentionSnapshots {
 constructor(private readonly db:DatabaseSync,private readonly runs:{get(key:RunKey):Run}){}
 preview(input:unknown):ParentRetentionPage{
  const command=captureParentCommand(input);const now=Date.parse(command.capturedAt);
  transaction(this.db,()=>pruneRetentionSnapshots(this.db,now));return transaction(this.db,()=>this.select(command,now));
 }
 private select(command:Command,now:number):ParentRetentionPage{
  const db=this.db;const request=command.request;const replay=replayParent(db,command);if(replay)return page(replay);
  const pin=parentPin(db,request.scope);if(pin.id!==request.settingsId)throw new StorageError('not_found');requireFact(pin.version===request.expectedVersion);
  const previous=previousParent(db,command);const window=parentWindow(db,request.scope,previous);
  if(!window)return{scope:request.scope,requestId:request.requestId,settingsId:pin.id,settingsVersion:pin.version,capturedAt:command.capturedAt,coverage:'live_partial',durable:false,workspace:null,nextCursor:null};
  const snapshot=this.snapshot(command,window,previous);
  if(previous?.candidates.length===0)commitRetentionHandoff(db,previous.id,now);
  return page(reserveRetentionSnapshot(db,snapshot,now));
 }
 private snapshot(command:Command,window:NonNullable<ReturnType<typeof parentWindow>>,previous:RetentionSnapshot|null){
  const request=command.request;const basis=retentionBasis(this.db,window.selected);const workspacePin=basis.settings.workspace;natural(workspacePin.version,Number.MAX_SAFE_INTEGER,1);
  const workspaceRequest={...request,scope:window.selected,settingsId:uuid(workspacePin.id),expectedVersion:workspacePin.version};
  const proposed=selectWindow(this.db,this.runs,{...command,request:workspaceRequest},basis,window.previousWindow);
  return captureRetentionSnapshot({...proposed,traversal:{scope:request.scope,horizon:window.last,nextWorkspace:window.next,previousSnapshotId:previous?.id??null}});
 }

}
