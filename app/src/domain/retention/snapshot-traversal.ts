import { validateApi } from '@beetle/contracts/api';
import type { WorkspaceScope,SettingsScope } from '@beetle/contracts/api';
import type { RetentionTraversalContext,ParentRetentionScope } from './snapshot-types.js';
import { closed,uuid,nullableUuid } from './snapshot-fields.js';
import { requireRule } from '../namespaces/index.js';
function workspace(input:unknown):WorkspaceScope{
 requireRule(validateApi('WorkspaceScope',input).ok);const value=input as WorkspaceScope;
 return{kind:'workspace',organizationId:uuid(value.organizationId),workspaceId:uuid(value.workspaceId)};
}
export function workspacePosition(scope:WorkspaceScope):string{return`${scope.organizationId}:${scope.workspaceId}`;}
export function captureTraversalContext(input:unknown,owner:WorkspaceScope,id:string,predecessorId:string|null):RetentionTraversalContext{
 closed(input,['scope','horizon','nextWorkspace','previousSnapshotId']);requireRule(validateApi('SettingsScope',input.scope).ok);const proposed=input.scope as SettingsScope;
 requireRule(proposed.kind!=='workspace');const scope:ParentRetentionScope=proposed.kind==='installation'?{kind:'installation'}:{kind:'organization',organizationId:uuid(proposed.organizationId)};
 const horizon=workspace(input.horizon);const nextWorkspace=input.nextWorkspace===null?null:workspace(input.nextWorkspace);const previousSnapshotId=nullableUuid(input.previousSnapshotId);
 requireRule(previousSnapshotId!==id&&(predecessorId===null||predecessorId===previousSnapshotId));requireRule(workspacePosition(owner)<=workspacePosition(horizon));
 if(scope.kind==='organization')requireRule(owner.organizationId===scope.organizationId&&horizon.organizationId===scope.organizationId);
 if(nextWorkspace!==null)requireRule(workspacePosition(nextWorkspace)>workspacePosition(owner)&&workspacePosition(nextWorkspace)<=workspacePosition(horizon));
 return{scope,horizon,nextWorkspace,previousSnapshotId};
}
