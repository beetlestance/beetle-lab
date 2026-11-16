import {exportOutputBinding} from './output-wire.js';
import {digest} from '../output-custody/slot.js';
import {validate,encodeCanonicalJson} from '@beetle/contracts';
import {validateApi} from '@beetle/contracts/api';
import type {ExportOperation,ExportValue} from './protocol.js';
import type {ExportControl,ExportKey,ExportScan,ExportCandidate} from '../../../../ports/exports.js';
import {captureOutputBinding,isExportOutput} from '../../../../domain/output-owner/index.js';
import {requireRule,sameScope,sameUuid} from '../../../../domain/namespaces/index.js';
import {boundedCopy,checkedJournalAuthority} from '../input-values.js';
import {closed} from '../output-custody/values.js';
export type ExecutionOperation=Extract<ExportOperation,{kind:'scanExportJobs'|'getExportOriginal'|'getExportControl'|'claimExport'|'observeExport'|'finalizeExport'}>;
export function privateExportOperation(input:ExportOperation):input is ExecutionOperation {
 return ['scanExportJobs','getExportOriginal','getExportControl','claimExport','observeExport','finalizeExport'].includes(input.kind);
}
function key(value:ExportKey):void{closed(value,['scope','id']);requireRule(validateApi('WorkspaceScope',value.scope).ok&&validateApi('Uuid',value.id).ok);}
function scan(value:ExportScan):void{
 closed(value,Object.hasOwn(value,'after')?['limit','after']:['limit']);requireRule(Number.isSafeInteger(value.limit)&&value.limit>=1&&value.limit<=32);
 if(value.after!==undefined)requireRule(Number.isSafeInteger(value.after)&&value.after>=0);
}
export function captureExecutionOperation(input:ExecutionOperation):ExecutionOperation {
 const value=boundedCopy(input,65536);captureHeader(value);
 if(value.kind==='scanExportJobs')scan(value.query);
 else if(value.kind==='finalizeExport'){
  closed(value.request,['binding','manifestDigest','sourceDigest']);exportOutputBinding(value.request.binding);
  requireRule(digest(value.request.manifestDigest)&&digest(value.request.sourceDigest));
 }else if(value.kind==='observeExport'){
  closed(value.request,['key','snapshot','journalAuthority']);key(value.request.key);checkedJournalAuthority(value.request.journalAuthority);
  requireRule(validate('AttemptSnapshot',value.request.snapshot).ok);
 }else key(value.key);
 return value;
}
function control(input:unknown,expected:ExportKey):ExportControl {
 const value=boundedCopy(input,4096) as ExportControl;
 closed(value,['key','binding','state','possibleDelivery','acknowledged','cancellationRequested','cancellationDelivered']);key(value.key);
 requireRule(sameScope(value.key.scope,expected.scope)&&sameUuid(value.key.id,expected.id));
 requireRule(['queued','dispatching','generating','publishing','ready','failed','cancelled','unknown'].includes(value.state));
 requireRule([value.possibleDelivery,value.acknowledged,value.cancellationRequested,value.cancellationDelivered].every(item=>typeof item==='boolean'));
 if(value.binding!==null){
  const binding=captureOutputBinding(value.binding);requireRule(isExportOutput(binding));
  requireRule(sameUuid(binding.key.exportId,value.key.id)&&sameUuid(binding.key.attempt.organizationId,expected.scope.organizationId)&&sameUuid(binding.key.attempt.workspaceId,expected.scope.workspaceId));
  requireRule(encodeCanonicalJson(binding,4096)===encodeCanonicalJson(value.binding,4096));
 }
 requireRule(!value.possibleDelivery||value.binding!==null);requireRule(!value.acknowledged||value.possibleDelivery);
 return value;
}
export function captureExecutionReply(operation:ExecutionOperation,input:unknown):ExportValue {
 if(operation.kind==='scanExportJobs')return scanReply(operation.query,input);
 if(operation.kind==='getExportOriginal')throw new Error('Original carrier has its own capture');
 if(operation.kind==='getExportControl')return control(input,operation.key);
 if(operation.kind==='observeExport'||operation.kind==='finalizeExport'){
  return captureJobReply(operation,input);
 }
 const value=boundedCopy(input,8192) as {kind:'blocked'}|{kind:'claimed'|'replay';control:ExportControl};
 if(value.kind==='blocked'){closed(value,['kind']);return value;}
 closed(value,['kind','control']);requireRule(value.kind==='claimed'||value.kind==='replay');const retained=control(value.control,operation.key);requireRule(retained.possibleDelivery&&retained.binding!==null);
 requireRule(!['ready','failed','cancelled'].includes(retained.state));return {kind:value.kind,control:retained};
}
function scanReply(query:ExportScan,input:unknown):readonly ExportCandidate[]{
 const values=boundedCopy(input,32768) as ExportCandidate[];requireRule(Array.isArray(values)&&values.length<=query.limit);
 let after=query.after??0;
 for(const item of values){closed(item,['order','key']);key(item.key);requireRule(Number.isSafeInteger(item.order)&&item.order>after);after=item.order;}
 return values;
}

function captureHeader(value:ExecutionOperation):void {
 const field=value.kind==='scanExportJobs'?'query':(value.kind==='observeExport'||value.kind==='finalizeExport')?'request':'key';
 closed(value,Object.hasOwn(value,'messageId')?['kind',field,'messageId']:['kind',field]);
 if('messageId'in value)requireRule(typeof value.messageId==='number'&&Number.isSafeInteger(value.messageId)&&value.messageId>0);
}

function captureJobReply(operation:Extract<ExecutionOperation,{kind:'observeExport'|'finalizeExport'}>,input:unknown):ExportValue {
  const value=boundedCopy(input,32768);const checked=validateApi('ExportJob',value);requireRule(checked.ok);
  const key=operation.kind==='observeExport'?operation.request.key:{id:operation.request.binding.key.exportId,scope:{kind:'workspace' as const,
   organizationId:operation.request.binding.key.attempt.organizationId,workspaceId:operation.request.binding.key.attempt.workspaceId}};
  requireRule(sameScope(checked.value.scope,key.scope)&&sameUuid(checked.value.id,key.id));return checked.value;
}
