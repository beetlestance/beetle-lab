import type { ApiOperation } from '../generated/operations.js';
import type { RetentionBatchStatus,RetentionBatchSummary,RetentionBatchList,RetentionDiscardReceipt,RetentionPreview,RetentionApplyReceipt,WorkspaceScope } from '../generated/types.js';
import type { PreparedInput } from './input.js';
const operations=new Set(['getWorkspaceRetentionPreview','previewWorkspaceRetention','applyWorkspaceRetention','previewRunDeletion','listWorkspaceRetention','getWorkspaceRetentionStatus','discardWorkspaceRetention']);
function uuid(left:string,right:unknown):boolean{return typeof right==='string'&&left.toLowerCase()===right.toLowerCase();}
function scope(owner:WorkspaceScope,target:WorkspaceScope):boolean{return owner.kind==='workspace'&&target.kind==='workspace'&&uuid(owner.organizationId,target.organizationId)&&uuid(owner.workspaceId,target.workspaceId);}
function canonical(value:string):boolean{const parsed=Date.parse(value);return Number.isFinite(parsed)&&value.length===24&&new Date(parsed).toISOString()===value;}
function lifetime(value:{capturedAt:string;expiresAt:string}):boolean{return canonical(value.capturedAt)&&canonical(value.expiresAt)&&Date.parse(value.expiresAt)-Date.parse(value.capturedAt)===900000;}
function distinct(values:readonly string[]):boolean{return new Set(values.map(value=>value.toLowerCase())).size===values.length;}
function summary(value:RetentionBatchSummary,target:WorkspaceScope):boolean{
 if(!scope(value.scope,target)||!lifetime(value)||(value.state==='completed')!==(value.completedAt!==null))return false;
 if(value.completedAt!==null&&(!canonical(value.completedAt)||Date.parse(value.completedAt)<Date.parse(value.capturedAt)))return false;
 return(value.kind!=='manual'||value.candidateCount===1)&&(value.state==='preview'||value.candidateCount>0);
}
type Item=RetentionBatchStatus['items'][number];
function stateMatches(value:RetentionBatchStatus):boolean{
 const settled=value.items.filter(item=>item.phase==='settled').length;
 if(settled!==value.completedCount)return false;
 if(value.state==='completed')return value.items.length>0&&settled===value.items.length;
 return value.state==='preview'?value.items.every(item=>item.phase==='preview'):settled<value.items.length;
}
function itemMatches(item:Item):boolean{
 if(!counts(item)||(item.phase==='blocked')!==(item.error!==null))return false;
 return item.phase==='settled'?item.refundedLogicalBytes>=62976:item.refundedLogicalBytes===0;
}
function status(value:RetentionBatchStatus,target:WorkspaceScope):boolean{
 if(!summary({...value,candidateCount:value.items.length},target))return false;
 if(!distinct(value.items.flatMap(item=>[item.runId,item.deletionId]))||!value.items.every(itemMatches))return false;
 const refunded=value.items.reduce((sum,item)=>sum+item.refundedLogicalBytes,0);
 return Number.isSafeInteger(refunded)&&refunded===value.refundedLogicalBytes&&refunded<=value.estimatedLogicalBytes&&stateMatches(value);
}
function nullCounts(item:Item):boolean{return item.preparedCount===null&&item.absentCount===null&&(item.phase==='preview'||item.phase==='blocked');}
function counts(item:Item):boolean{
 if(item.fileCount===null)return nullCounts(item);
 if(item.fileCount>128||item.preparedCount===null||item.absentCount===null||item.preparedCount>item.fileCount||item.absentCount>item.preparedCount)return false;
 return!['settled','settling','agent_cleanup'].includes(item.phase)||item.absentCount===item.fileCount;
}
function intentMatches(value:RetentionPreview|RetentionApplyReceipt,input:PreparedInput):boolean{
 const body=input.body!;return uuid(value.requestId,body.requestId)&&uuid(value.settingsId,body.settingsId)&&value.settingsVersion===body.expectedVersion;
}
function manualMatches(value:RetentionPreview,input:PreparedInput):boolean{
 const item=value.candidates[0];return value.kind==='manual'&&value.scanned===1&&value.nextCursor===null&&value.candidates.length===1&&item!.reason==='manual'
  &&uuid(item!.id,input.params.runId)&&item!.version===input.body!.expectedRunVersion;
}
function previewStructure(value:RetentionPreview):boolean{
 if(value.candidates.length+value.protectedExclusions.reduce((sum,item)=>sum+item.count,0)>value.scanned)return false;
 if(value.nextCursor!==null&&value.nextCursor!==btoa(value.snapshotId.toLowerCase()))return false;
 if(!distinct(value.protectedExclusions.map(item=>item.reason)))return false;
 if(value.kind==='manual')return value.scanned===1&&value.nextCursor===null&&value.candidates.length===1&&value.candidates[0]!.reason==='manual';
 return value.candidates.every(item=>item.reason!=='manual');
}
function previewWindow(value:RetentionPreview,input:PreparedInput):boolean{
 if(input.params.runId)return manualMatches(value,input);
 return value.kind==='retention'&&value.scanned<=(input.body!.page as {limit:number}).limit;
}
function preview(value:RetentionPreview,input:PreparedInput,target:WorkspaceScope):boolean{
 if(!scope(value.scope as WorkspaceScope,target)||!lifetime(value))return false;
 if(!distinct(value.candidates.map(item=>item.id))||!value.candidates.every(item=>scope(item.scope,target)))return false;
 const total=value.candidates.reduce((sum,item)=>sum+item.estimatedBytes,0);
 if(!Number.isSafeInteger(total)||total!==value.estimatedBytes||!previewStructure(value))return false;
 if(!input.body)return uuid(value.snapshotId,input.params.snapshotId);
 return intentMatches(value,input)&&previewWindow(value,input);
}
function apply(reply:RetentionApplyReceipt,input:PreparedInput,target:WorkspaceScope):boolean{
 const body=input.body!;const page=body.page as {limit:number};
 return scope(reply.scope as WorkspaceScope,target)&&intentMatches(reply,input)&&uuid(reply.snapshotId,body.snapshotId)&&reply.snapshotVersion===body.snapshotVersion&&reply.maximumCandidates===page.limit;
}
function list(reply:RetentionBatchList,target:WorkspaceScope):boolean{return scope(reply.scope,target)&&distinct(reply.items.map(item=>item.id))&&reply.items.every(item=>summary(item,target));}
/** Called only after closed generated-schema validation. */
export function retentionResponseMatches(operation:ApiOperation,input:PreparedInput,value:unknown):boolean|undefined{
 if(!operations.has(operation.name))return undefined;
 const target:WorkspaceScope={kind:'workspace',organizationId:input.params.organizationId!,workspaceId:input.params.workspaceId!};
 switch(operation.response){
  case 'RetentionPreview':return preview(value as RetentionPreview,input,target);
  case 'RetentionApplyReceipt':return apply(value as RetentionApplyReceipt,input,target);
  case 'RetentionBatchList':return list(value as RetentionBatchList,target);
  case 'RetentionBatchStatus':{const reply=value as RetentionBatchStatus;return uuid(reply.id,input.params.snapshotId)&&status(reply,target);}
  case 'RetentionDiscardReceipt':{const reply=value as RetentionDiscardReceipt;return scope(reply.scope,target)&&uuid(reply.id,input.params.snapshotId);}
  default:return false;
 }
}
export function retentionRequestMatches(operation:ApiOperation,input:PreparedInput):boolean{
 return operation.name!=='previewRunDeletion'||uuid(input.params.runId!,input.body!.runId);
}
