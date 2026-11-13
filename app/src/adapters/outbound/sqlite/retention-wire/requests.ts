import { encodeJson } from '@beetle/contracts';
import type { RetentionOperation } from '../../../../ports/retention.js';
import { closed,natural,uuid,scope } from '../output-deletion/values.js';
import { capturePreviewCommand } from '../retention-selection/values.js';
import { captureManualCommand } from '../retention-manual/values.js';
import { captureApplyCommand } from '../retention-apply/values.js';
import { requireFact } from '../retention-accounting/facts.js';
const names=['previewRunDeletion','previewWorkspaceRetention','applyWorkspaceRetention','getWorkspaceRetentionStatus','discardWorkspaceRetention'];
export function retentionOperation(value:unknown):value is RetentionOperation{
 const field=value&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,'kind'):undefined;
 return !!field&&'value'in field&&names.includes(field.value as string);
}
export function captureRetentionOperation(input:unknown):RetentionOperation{
 const value:unknown=JSON.parse(encodeJson(input,12288));requireFact(retentionOperation(value));const member='command'in value?'command':'request';
 const envelope=value as RetentionOperation&{messageId?:number};const hasMessageId=Object.hasOwn(envelope,'messageId');
 closed(envelope,['kind',member,...(hasMessageId?['messageId']:[])]);if(hasMessageId)natural(envelope.messageId,Number.MAX_SAFE_INTEGER,1);
 if(envelope.kind==='previewWorkspaceRetention'){const {intentDigest,...command}=capturePreviewCommand(envelope.command);void intentDigest;return{kind:envelope.kind,command};}
 if(envelope.kind==='previewRunDeletion'){const {intentDigest,...command}=captureManualCommand(envelope.command);void intentDigest;return{kind:envelope.kind,command};}
 if(envelope.kind==='applyWorkspaceRetention'){const {intentDigest,...command}=captureApplyCommand(envelope.command);void intentDigest;return{kind:envelope.kind,command};}
 closed(envelope.request,['key','now']);closed(envelope.request.key,['scope','id']);natural(envelope.request.now,253402300799999);
 return{kind:envelope.kind,request:{key:{scope:scope(envelope.request.key.scope),id:uuid(envelope.request.key.id)},now:envelope.request.now}};
}
