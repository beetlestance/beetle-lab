import type { RetentionTraversalPage,SettingsScope } from '../generated/types.js';
import type { PreparedInput } from './input.js';
import { retentionPreviewValuesMatch } from './retention-ownership.js';
function uuid(left:string,right:unknown):boolean{return typeof right==='string'&&left.toLowerCase()===right.toLowerCase();}
function parent(left:RetentionTraversalPage['scope'],right:SettingsScope):boolean{
 if(left.kind!==right.kind)return false;if(left.kind==='installation')return true;
 return right.kind==='organization'&&uuid(left.organizationId,right.organizationId);
}
function canonical(value:string):boolean{const parsed=Date.parse(value);return Number.isFinite(parsed)&&value.length===24&&new Date(parsed).toISOString()===value;}
function header(input:PreparedInput,value:RetentionTraversalPage):boolean{
 const body=input.body!;return parent(value.scope,body.scope as SettingsScope)&&uuid(value.requestId,body.requestId)
  &&uuid(value.settingsId,body.settingsId)&&value.settingsVersion===body.expectedVersion&&canonical(value.capturedAt);
}
function nested(input:PreparedInput,value:RetentionTraversalPage):boolean{
 const workspace=value.workspace!;if(workspace.scope.kind!=='workspace')return false;
 if(!value.durable||workspace.kind!=='retention')return false;
 if(value.scope.kind==='organization'&&!uuid(value.scope.organizationId,workspace.scope.organizationId))return false;
 return workspace.capturedAt===value.capturedAt&&uuid(workspace.requestId,value.requestId)&&workspace.scanned<=(input.body!.page as {limit:number}).limit
  &&retentionPreviewValuesMatch(workspace,workspace.scope)&&continuation(value);
}
/** A live/partial envelope cannot grant parent-wide application or aggregate budgets. */
export function parentRetentionMatches(input:PreparedInput,value:RetentionTraversalPage):boolean{
 if(!header(input,value))return false;
 return value.workspace===null?!value.durable&&value.nextCursor===null:nested(input,value);
}
function continuation(value:RetentionTraversalPage):boolean{
 const workspace=value.workspace!;if(value.nextCursor!==null&&value.nextCursor!==btoa(workspace.snapshotId.toLowerCase()))return false;
 return workspace.nextCursor===null||value.nextCursor===workspace.nextCursor;
}
