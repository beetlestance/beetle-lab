import type { DatabaseSync } from 'node:sqlite';
import type { RetentionSnapshot,ParentRetentionScope } from '../../../../domain/retention/index.js';
import { sameScope } from '../../../../domain/namespaces/index.js';
import { snapshotById } from '../retention-selection/rows.js';
import { requireSnapshotBasis } from '../retention-selection/basis.js';
import { retentionBasis } from '../retention-accounting/index.js';
import { requireFact } from '../retention-accounting/facts.js';
import { StorageError } from '../protocol.js';
import { parentSnapshotHeaders } from './rows.js';
import { cursorSnapshot } from '../retention-selection/values.js';
import type { captureParentCommand } from './values.js';
function stored(db:DatabaseSync,row:Record<string,unknown>){
 requireFact(typeof row.id==='string'&&typeof row.organization_id==='string'&&typeof row.workspace_id==='string','unavailable');
 return snapshotById(db,{kind:'workspace',organizationId:row.organization_id,workspaceId:row.workspace_id},row.id);
}
export function parentSnapshotPin(snapshot:RetentionSnapshot,scope:ParentRetentionScope){return scope.kind==='installation'?snapshot.settings.installation:snapshot.settings.organization;}
export function replayParent(db:DatabaseSync,command:ReturnType<typeof captureParentCommand>):RetentionSnapshot|null{
 for(const row of parentSnapshotHeaders(db,command.request.requestId)){
  const snapshot=stored(db,row).snapshot;if(!snapshot.traversal||!sameScope(snapshot.traversal.scope,command.request.scope))continue;
  requireFact(snapshot.intentDigest===command.intentDigest&&Date.parse(snapshot.expiresAt)>Date.parse(command.capturedAt));return snapshot;
 }return null;
}
export function previousParent(db:DatabaseSync,command:ReturnType<typeof captureParentCommand>):RetentionSnapshot|null{
 const request=command.request;if(!request.page.cursor)return null;const id=cursorSnapshot(request.page.cursor);
 const row=db.prepare('SELECT id,organization_id,workspace_id FROM retention_snapshots WHERE id=?').get(id);if(!row)throw new StorageError('not_found');
 const value=stored(db,row);const snapshot=value.snapshot;const context=snapshot.traversal;
 if(!context||!sameScope(context.scope,request.scope))throw new StorageError('not_found');
 requireFact(value.state==='preview'&&(snapshot.hasMore||context.nextWorkspace!==null)&&Date.parse(snapshot.expiresAt)>Date.parse(command.capturedAt));
 requireSnapshotBasis(snapshot,retentionBasis(db,snapshot.scope));const pin=parentSnapshotPin(snapshot,request.scope);
 requireFact(pin.id===request.settingsId&&pin.version===request.expectedVersion);return snapshot;
}
