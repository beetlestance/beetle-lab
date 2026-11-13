import { encodeJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import { captureRetentionSnapshot } from '../../../../domain/retention/index.js';
import type { RetentionMetadata,RetentionOperation,RetentionValue } from '../../../../ports/retention.js';
import { requireFact } from '../retention-accounting/facts.js';
import { capturePreviewCommand,cursorSnapshot } from '../retention-selection/values.js';
import { captureRetentionStatus } from './status.js';
import { captureRetentionOperation } from './requests.js';
export { retentionOperation,captureRetentionOperation } from './requests.js';
export function retentionReplyLimit(operation:RetentionOperation):number{return operation.kind==='applyWorkspaceRetention'||operation.kind==='discardWorkspaceRetention'?2048:32768;}
function previewReply(operation:Extract<RetentionOperation,{kind:'previewWorkspaceRetention'}>,input:unknown){
 const snapshot=captureRetentionSnapshot(input);const command=capturePreviewCommand(operation.command);const request=command.request;
 requireFact(snapshot.kind==='retention'&&snapshot.requestId===request.requestId&&snapshot.intentDigest===command.intentDigest);
 requireFact(snapshot.scope.organizationId===request.scope.organizationId&&snapshot.scope.workspaceId===request.scope.workspaceId);
 requireFact(snapshot.settings.workspace.id===request.settingsId&&snapshot.settings.workspace.version===request.expectedVersion&&snapshot.scanned<=request.page.limit);
 requireFact(snapshot.predecessorId===(request.page.cursor?cursorSnapshot(request.page.cursor):null));return snapshot;
}
function applyReply(operation:Extract<RetentionOperation,{kind:'applyWorkspaceRetention'}>,input:unknown){
 const copy:unknown=JSON.parse(encodeJson(input,2048));const checked=validateApi('RetentionApplyReceipt',copy);requireFact(checked.ok);const receipt=checked.value;const request=operation.command.request;
 requireFact(receipt.scope.kind==='workspace'&&receipt.scope.organizationId===request.scope.organizationId&&receipt.scope.workspaceId===request.scope.workspaceId);
 requireFact(receipt.version===1&&receipt.requestId===request.requestId&&receipt.snapshotId===request.snapshotId&&receipt.snapshotVersion===1);
 requireFact(receipt.settingsId===request.settingsId&&receipt.settingsVersion===request.expectedVersion&&receipt.maximumCandidates===request.page.limit);return receipt;
}
function discardReply(operation:Extract<RetentionOperation,{kind:'getWorkspaceRetentionStatus'|'discardWorkspaceRetention'}>,input:unknown){
 const copy:unknown=JSON.parse(encodeJson(input,2048));requireFact(copy&&typeof copy==='object'&&!Array.isArray(copy));const value=copy as Record<string,unknown>;
 requireFact(Object.keys(value).length===3&&value.id===operation.request.key.id&&value.refundedLogicalBytes===131072);
 requireFact(validateApi('WorkspaceScope',value.scope).ok);const owner=value.scope as typeof operation.request.key.scope;
 requireFact(owner.organizationId===operation.request.key.scope.organizationId&&owner.workspaceId===operation.request.key.scope.workspaceId);
 return{id:operation.request.key.id,scope:operation.request.key.scope,refundedLogicalBytes:131072 as const};
}
export function captureRetentionReply(operation:RetentionOperation,input:unknown):RetentionValue{
 const original=captureRetentionOperation(operation);
 switch(original.kind){
  case 'previewWorkspaceRetention':return previewReply(original,input);
  case 'applyWorkspaceRetention':return applyReply(original,input);
  case 'getWorkspaceRetentionStatus':return captureRetentionStatus(input,original.request.key);
  case 'discardWorkspaceRetention':return discardReply(original,input);
 }
}
export function retentionClient(call:(operation:RetentionOperation)=>Promise<unknown>):RetentionMetadata{
 const client:RetentionMetadata={preview:command=>call({kind:'previewWorkspaceRetention',command}) as ReturnType<RetentionMetadata['preview']>,
  apply:command=>call({kind:'applyWorkspaceRetention',command}) as ReturnType<RetentionMetadata['apply']>,
  get:(key,now)=>call({kind:'getWorkspaceRetentionStatus',request:{key,now}}) as ReturnType<RetentionMetadata['get']>,
  discard:(key,now)=>call({kind:'discardWorkspaceRetention',request:{key,now}}) as ReturnType<RetentionMetadata['discard']>};return Object.freeze(client);
}
