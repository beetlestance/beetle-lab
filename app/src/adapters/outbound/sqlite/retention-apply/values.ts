import { encodeJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { RetentionApplyReceipt } from '@beetle/contracts/api';
import type { WorkspaceRetentionApplyRequest } from '../../../../ports/retention.js';
import { requireRule,immutableSnapshot,sameScope } from '../../../../domain/namespaces/index.js';
import type { RetentionSnapshot } from '../../../../domain/retention/index.js';
import { normalizedScope } from '../suites.js';
import { lower,sha256 } from '../input-values.js';
import { digestMutationIntent } from '../../../../application/namespaces/index.js';
export interface AppliedSnapshot {readonly version:1;readonly requestId:string;readonly intentDigest:string;readonly appliedAt:string;readonly receipt:RetentionApplyReceipt}
function closed(value:unknown,names:readonly string[]):asserts value is Record<string,unknown>{
 requireRule(value!==null&&typeof value==='object'&&!Array.isArray(value));requireRule(Object.keys(value).length===names.length&&names.every(key=>Object.hasOwn(value,key)));
}
function timestamp(value:unknown):string{
 requireRule(typeof value==='string'&&value.length===24);const parsed=Date.parse(value);
 requireRule(Number.isFinite(parsed)&&new Date(parsed).toISOString()===value);return value;
}
export function captureApplyCommand(input:unknown){
 const value:unknown=JSON.parse(encodeJson(input,8192));closed(value,['id','appliedAt','request']);requireRule(validateApi('Uuid',value.id).ok);
 const checked=validateApi('RetentionApplyRequest',value.request);requireRule(checked.ok);const request=checked.value;requireRule(request.scope.kind==='workspace');
 const owned:WorkspaceRetentionApplyRequest={scope:normalizedScope(request.scope),settingsId:lower(request.settingsId),requestId:lower(request.requestId),expectedVersion:request.expectedVersion,
  snapshotId:lower(request.snapshotId),snapshotVersion:request.snapshotVersion,page:request.page};
 return{id:lower(value.id as string),appliedAt:timestamp(value.appliedAt),request:owned,intentDigest:digestMutationIntent({kind:'workspaceRetentionApply',request:owned},sha256)};
}
/** Stored receipt validation uses the immutable original, never current settings/expiry. */
export function captureAppliedSnapshot(input:unknown,snapshot:RetentionSnapshot):AppliedSnapshot{
 const value:unknown=JSON.parse(encodeJson(input,2048));closed(value,['version','requestId','intentDigest','appliedAt','receipt']);
 requireRule(value.version===1&&validateApi('Uuid',value.requestId).ok&&typeof value.intentDigest==='string'&&/^[0-9a-f]{64}$/.test(value.intentDigest));
 const appliedAt=timestamp(value.appliedAt);const checked=validateApi('RetentionApplyReceipt',value.receipt);requireRule(checked.ok);const receipt=checked.value;
 requireRule(receipt.version===1&&sameScope(receipt.scope,snapshot.scope)&&receipt.requestId===value.requestId);
 requireRule(receipt.snapshotId===snapshot.id&&receipt.snapshotVersion===1&&receipt.maximumCandidates===snapshot.candidates.length);
 requireRule(receipt.settingsId===snapshot.settings.workspace.id&&receipt.settingsVersion===snapshot.settings.workspace.version);
 requireRule(Date.parse(appliedAt)>=Date.parse(snapshot.capturedAt)&&Date.parse(appliedAt)<Date.parse(snapshot.expiresAt));
 return immutableSnapshot({version:1,requestId:lower(value.requestId as string),intentDigest:value.intentDigest,appliedAt,receipt});
}
