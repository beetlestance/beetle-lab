import { encodeJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { WorkspaceRetentionPreviewCommand,WorkspaceRetentionPreviewRequest } from '../../../../ports/retention.js';
import { requireRule } from '../../../../domain/namespaces/index.js';
import { normalizedScope } from '../suites.js';
import { lower,sha256 } from '../input-values.js';
import { digestMutationIntent } from '../../../../application/namespaces/index.js';
export function capturePreviewCommand(input:unknown):WorkspaceRetentionPreviewCommand&{readonly intentDigest:string}{
 const copy:unknown=JSON.parse(encodeJson(input,8192));requireRule(copy!==null&&typeof copy==='object'&&!Array.isArray(copy));
 const value=copy as Record<string,unknown>;requireRule(Object.keys(value).length===3&&['id','capturedAt','request'].every(key=>Object.hasOwn(value,key)));
 requireRule(validateApi('Uuid',value.id).ok&&typeof value.capturedAt==='string'&&value.capturedAt.length===24);
 const parsed=Date.parse(value.capturedAt);requireRule(Number.isFinite(parsed)&&new Date(parsed).toISOString()===value.capturedAt);
 const checked=validateApi('RetentionPreviewRequest',value.request);requireRule(checked.ok&&checked.value.scope.kind==='workspace');const request=checked.value;requireRule(request.scope.kind==='workspace');
 const owned:WorkspaceRetentionPreviewRequest={scope:normalizedScope(request.scope),requestId:lower(request.requestId),expectedVersion:request.expectedVersion,settingsId:lower(request.settingsId),page:request.page};
 return{id:lower(value.id as string),capturedAt:value.capturedAt,request:owned,intentDigest:digestMutationIntent({kind:'workspaceRetentionPreview',request:owned},sha256)};
}
export function previewCursor(id:string):string{return Buffer.from(id,'utf8').toString('base64url');}
export function cursorSnapshot(input:string):string{
 requireRule(input.length===48&&/^[A-Za-z0-9_-]+$/.test(input));const value=Buffer.from(input,'base64url').toString('utf8');
 requireRule(validateApi('Uuid',value).ok&&value===lower(value)&&previewCursor(value)===input);return value;
}
