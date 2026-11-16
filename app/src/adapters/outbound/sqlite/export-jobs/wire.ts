import type {ExecutionOperation} from './execution-wire.js';
import {captureExportOutput,captureExportOutputReply,exportOutputRequestBytes,exportOutputReplyBytes} from './output-wire.js';
import {encodeCanonicalJson} from '@beetle/contracts';
import {validateApi} from '@beetle/contracts/api';
import type {ExportJob,ExportJobPage} from '@beetle/contracts/api';
import type {CreateExportCommand} from '../../../../ports/exports.js';
import type {ExportOperation,ExportValue} from './protocol.js';
import {prepareExportCommand,prepareExportCancellation} from '../../../../application/exports/index.js';
import {requireRule,sameScope,sameUuid} from '../../../../domain/namespaces/index.js';
import {boundedCopy,sha256} from '../input-values.js';
import {privateExportOperation,captureExecutionOperation,captureExecutionReply} from './execution-wire.js';
import {captureExportOriginal} from './original-wire.js';
import {closed} from '../output-custody/values.js';

export function exportOperation(input:unknown):input is ExportOperation {
 if(input===null||typeof input!=='object')return false;const kind=Object.getOwnPropertyDescriptor(input,'kind');
 return !!kind&&'value'in kind&&['exportJob','getExport','listExports','getExportProfiles','scanExportJobs','getExportOriginal','getExportControl','claimExport','observeExport','finalizeExport','exportOutput'].includes(kind.value as string);
}
export function captureExportOperation(input:ExportOperation):ExportOperation {
 if(input.kind==='exportOutput'){
  const value=boundedCopy(input,81920);closed(value,Object.hasOwn(value,'messageId')?['kind','operation','messageId']:['kind','operation']);
  return {kind:'exportOutput',operation:captureExportOutput(value.operation)};
 }
 if(privateExportOperation(input))return captureExecutionOperation(input);
 return capturePublicOperation(input);
}
function capturePublicOperation(input:Exclude<ExportOperation,ExecutionOperation|{kind:'exportOutput'}>):ExportOperation {
 const value=boundedCopy(input,65536);publicHeader(value);
 if(value.kind==='exportJob'){
  const expected=value.command.kind==='createExport'?prepareExportCommand(value.command,sha256):prepareExportCancellation(value.command,sha256);
  requireRule(expected.intentDigest===value.command.intentDigest);return {...value,command:expected};
 }
 if(value.kind==='getExport'){
  closed(value.key,['scope','id']);requireRule(validateApi('WorkspaceScope',value.key.scope).ok&&validateApi('Uuid',value.key.id).ok);
 }else if(value.kind==='listExports'){
  const {scope,...page}=value.query;requireRule(validateApi('WorkspaceScope',scope).ok&&validateApi('PageQuery',page).ok);
 }else requireRule(validateApi('WorkspaceScope',value.scope).ok);
 return value;
}
export function exportRequestLimit(operation:ExportOperation):number{return operation.kind==='exportOutput'?exportOutputRequestBytes(operation.operation):65536;}
export function exportReplyLimit(operation:ExportOperation):number{if(operation.kind==='exportOutput')return exportOutputReplyBytes(operation.operation);return operation.kind==='getExportOriginal'?2109440:operation.kind==='listExports'?262144:32768;}
export function captureExportReply(operation:ExportOperation,input:unknown):ExportValue {
 if(operation.kind==='exportOutput')return captureExportOutputReply(operation.operation,input);
 if(operation.kind==='getExportOriginal')return captureExportOriginal(input,operation.key);
 if(privateExportOperation(operation))return captureExecutionReply(operation,input);
 return capturePublicReply(operation,input);
}
function capturePublicReply(operation:Exclude<ExportOperation,ExecutionOperation|{kind:'exportOutput'}>,input:unknown):ExportValue {
 const value=boundedCopy(input,exportReplyLimit(operation));
 const name=operation.kind==='listExports'?'ExportJobPage':operation.kind==='getExportProfiles'?'ExportProfiles':'ExportJob';
 const checked=validateApi(name,value);requireRule(checked.ok);
 const expected=operation.kind==='exportJob'?operation.command.request.scope:operation.kind==='getExport'?operation.key.scope:
  operation.kind==='listExports'?operation.query.scope:operation.scope;
 requireRule(sameScope(checked.value.scope,expected));
 if(name==='ExportJob')return captureJobReply(operation,checked.value as ExportJob);
 if(name==='ExportJobPage')requireRule((checked.value as ExportJobPage).items.every(item=>sameScope(item.scope,expected)));
 return checked.value;
}
function captureJobReply(operation:ExportOperation,job:ExportJob):ExportJob {
 if(operation.kind==='getExport')requireRule(sameUuid(job.id,operation.key.id));
 if(operation.kind==='exportJob'){
  const command=operation.command;
  if(command.kind==='cancelExport'){
   requireRule(sameUuid(job.id,command.id));requireRule(job.cancellationRequested||['ready','failed','cancelled'].includes(job.state));
  }else captureCreationReply(command,job);
 }
 return job;
}

function captureCreationReply(command:CreateExportCommand,job:ExportJob):void {
 requireRule(sameUuid(job.revisionId,command.request.revisionId));requireRule(job.sourceProfileId===command.request.engineProfile);
 const expected={budget:command.request.budget,executionPolicy:command.request.executionPolicy,options:command.request.options};
 const actual={budget:job.budget,executionPolicy:job.executionPolicy,options:job.options};
 requireRule(encodeCanonicalJson(expected,4096)===encodeCanonicalJson(actual,4096));
 requireRule(job.version===1&&job.state==='queued'&&!job.cancellationRequested&&job.reason===null);
}

function publicHeader(value:Exclude<ExportOperation,ExecutionOperation|{kind:'exportOutput'}>):void {
const field=value.kind==='exportJob'?'command':value.kind==='getExport'?'key':value.kind==='listExports'?'query':'scope';
 closed(value,Object.hasOwn(value,'messageId')?['kind',field,'messageId']:['kind',field]);
 if('messageId'in value)requireRule(typeof value.messageId==='number'&&Number.isSafeInteger(value.messageId)&&value.messageId>0);
}
