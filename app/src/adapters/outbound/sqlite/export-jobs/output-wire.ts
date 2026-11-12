import {encodeCanonicalJson,captureExportResultForExpectation} from '@beetle/contracts';
import {verifySourceEnvelope,captureOutputAbsence} from '@beetle/contracts/output-source';
import {validateApi} from '@beetle/contracts/api';
import {decodeArtifact} from '../output-custody/slot.js';
import {captureOutputBinding,isExportOutput} from '../../../../domain/output-owner/index.js';
import type {ExportOutputBinding} from '../../../../domain/output-owner/index.js';
import {requireRule} from '../../../../domain/namespaces/index.js';
import {boundedCopy,sha256} from '../input-values.js';
import {closed} from '../output-custody/values.js';
import {captureOutputState} from '../output-state.js';
import {captureArtifactMutation,captureArtifactReply} from '../output-artifacts/index.js';
import type {ExportOutputCommand,ExportOutputValue} from './output-protocol.js';
export function exportOutputBinding(input:unknown):ExportOutputBinding {
 const value=captureOutputBinding(input);requireRule(isExportOutput(value));return value;
}
export function captureExportOutput(input:ExportOutputCommand):ExportOutputCommand {
 const value=boundedCopy(input,input.method==='adopt'?81920:8192);
 if(value.method==='published'){
  closed(value,['method','key']);closed(value.key,['scope','id']);
  requireRule(validateApi('WorkspaceScope',value.key.scope).ok&&validateApi('Uuid',value.key.id).ok);return value;
 }
 if(value.method==='artifact'){
  closed(value,['method','operation']);return {method:'artifact',operation:captureArtifactMutation(value.operation,exportOutputBinding)};
 }
 if(value.method==='absence'){
  closed(value,['method','request']);closed(value.request,['binding','proof']);const binding=exportOutputBinding(value.request.binding);
  const proof=captureOutputAbsence(value.request.proof,{...binding.key.attempt,journalAuthority:binding.journalAuthority});
  return {method:'absence',request:{binding,proof}};
 }
 if(value.method==='adopt'){
  closed(value,['method','request']);closed(value.request,['binding','envelope']);
  const binding=exportOutputBinding(value.request.binding);const envelope=verifySourceEnvelope(value.request.envelope,sha256);
  captureExportResultForExpectation(envelope.manifest.result,binding.expectation,sha256);return {method:'adopt',request:{binding,envelope}};
 }
 closed(value,['method','binding']);requireRule(value.method==='load'||value.method==='source');
 return {method:value.method,binding:exportOutputBinding(value.binding)};
}
export function captureExportOutputReply(command:ExportOutputCommand,input:unknown):ExportOutputValue {
 if(command.method==='published')return publishedReply(command,input);
 if(command.method==='absence')return absenceReply(command,input);
 if(command.method==='artifact')return captureArtifactReply(command.operation,input);
 const binding=command.method==='adopt'?command.request.binding:command.binding;
 if(command.method==='source'){
  if(input===null)return null;const value=verifySourceEnvelope(boundedCopy(input,75776),sha256);
  const remote=value.manifest.binding;const a=binding.key.attempt;
  requireRule(encodeCanonicalJson({organizationId:remote.organizationId,workspaceId:remote.workspaceId,attemptId:remote.attemptId,generation:remote.generation,
   intentDigest:remote.intentDigest},2048)===encodeCanonicalJson(a,2048)&&remote.journalAuthority===binding.journalAuthority);
  captureExportResultForExpectation(value.manifest.result,binding.expectation,sha256);return value;
 }
 const value=captureOutputState(input,binding);if(value.kind==='adopted')requireRule(value.artifacts.length<=1);return value;
}
export function exportOutputRequestBytes(command:ExportOutputCommand):number{return command.method==='adopt'?81920:8192;}
export function exportOutputReplyBytes(command:ExportOutputCommand):number{return command.method==='source'?75776:command.method==='absence'?32768:8192;}

function publishedReply(command:Extract<ExportOutputCommand,{method:'published'}>,input:unknown):ExportOutputValue {
  const value=boundedCopy(input,8192) as {binding:ExportOutputBinding;artifact:unknown};closed(value,['binding','artifact']);
  const binding=exportOutputBinding(value.binding);const key=command.key;
  requireRule(binding.key.exportId.toLowerCase()===key.id.toLowerCase()&&binding.key.attempt.organizationId.toLowerCase()===key.scope.organizationId.toLowerCase()
   &&binding.key.attempt.workspaceId.toLowerCase()===key.scope.workspaceId.toLowerCase());
  const artifact=decodeArtifact(value.artifact);requireRule(artifact.phase==='published'&&artifact.offset===artifact.bytes&&artifact.writer===null&&artifact.identity!==null);
  return {binding,artifact};
}
function absenceReply(command:Extract<ExportOutputCommand,{method:'absence'}>,input:unknown):ExportOutputValue {
  const value=validateApi('ExportJob',boundedCopy(input,32768));requireRule(value.ok);const binding=command.request.binding;
  requireRule(value.value.id===binding.key.exportId&&value.value.scope.organizationId===binding.key.attempt.organizationId
   &&value.value.scope.workspaceId===binding.key.attempt.workspaceId&&['failed','cancelled'].includes(value.value.state));return value.value;
}
