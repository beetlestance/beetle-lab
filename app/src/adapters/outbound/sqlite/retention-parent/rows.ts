import type { DatabaseSync } from 'node:sqlite';
import type { WorkspaceScope } from '@beetle/contracts/api';
import type { ParentRetentionScope } from '../../../../domain/retention/index.js';
import { scopeKey } from '../input-values.js';
import { StorageError } from '../protocol.js';
import { requireFact } from '../retention-accounting/facts.js';
import { uuid } from '../output-deletion/values.js';
export function parentPin(db:DatabaseSync,scope:ParentRetentionScope){
 const row=db.prepare('SELECT id,version FROM settings WHERE scope_key=?').get(scopeKey(scope));if(!row)throw new StorageError('not_found');
 requireFact(typeof row.version==='number'&&Number.isSafeInteger(row.version)&&row.version>=1,'unavailable');return{id:uuid(row.id),version:row.version};
}
function workspace(row:Record<string,unknown>):WorkspaceScope{return{kind:'workspace',organizationId:uuid(row.organization_id),workspaceId:uuid(row.id)};}
export function horizon(db:DatabaseSync,scope:ParentRetentionScope):WorkspaceScope|null{
 const where=scope.kind==='organization'?' WHERE organization_id=?':'';const args=scope.kind==='organization'?[scope.organizationId]:[];
 const row=db.prepare(`SELECT organization_id,id FROM workspaces INDEXED BY workspaces_page${where} ORDER BY organization_id DESC,id DESC LIMIT 1`).get(...args);return row?workspace(row):null;
}
/** One current workspace and one existence probe, using the namespace tuple index. */
export function workspaceWindow(db:DatabaseSync,scope:ParentRetentionScope,last:WorkspaceScope,after:WorkspaceScope|null):readonly WorkspaceScope[]{
 const filter=scope.kind==='organization'?'organization_id=? AND ':'';const args=scope.kind==='organization'?[scope.organizationId]:[];
 const cursor=after?' AND (organization_id,id)>(?,?)':'';const prefix=after?[after.organizationId,after.workspaceId]:[];
 return db.prepare(`SELECT organization_id,id FROM workspaces INDEXED BY workspaces_page WHERE ${filter}(organization_id,id)<=(?,?)${cursor} ORDER BY organization_id,id LIMIT 2`)
  .all(...args,last.organizationId,last.workspaceId,...prefix).map(workspace);
}
export function parentSnapshotHeaders(db:DatabaseSync,requestId?:string){
 return db.prepare(`SELECT id,organization_id,workspace_id FROM retention_snapshots${requestId?' WHERE request_id=?':''} ORDER BY id LIMIT 8`).all(...(requestId?[requestId]:[]));
}
