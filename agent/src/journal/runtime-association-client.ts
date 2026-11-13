import {encodeCanonicalJson,encodeJson} from '@beetle/contracts';
import {runtimeAssociationObservationFacts} from '../backends/docker/index.js';
import {bindRuntimeAssociation,captureRuntimeAssociation,runtimeAssociationBytes} from '../runtime-association/index.js';
import type {JournalRuntimeAssociations,ObservedRuntimeAssociation,RuntimeAssociation} from '../runtime-association/index.js';
import {captureRetirementIntent} from '../retirement-values/index.js';
import type {RetirementIntent} from '../retirement-values/index.js';
import {sourceScope} from './output-source-input.js';
import type {RuntimeAssociationOperation} from './runtime-association-protocol.js';
interface Options{send(operation:()=>RuntimeAssociationOperation):Promise<unknown>;invalidReply():never;settleCarrier():Promise<void>}
function original(intent:RetirementIntent){
 const request=intent.request;return {organizationId:request.organizationId,workspaceId:request.workspaceId,attemptId:request.attemptId,generation:request.generation,intentDigest:request.intentDigest};
}
function scope(intent:RetirementIntent){const {intentDigest,...key}=original(intent);void intentDigest;return sourceScope(key);}
function observedValue(intent:RetirementIntent,token:ObservedRuntimeAssociation):RuntimeAssociation{
 const facts=runtimeAssociationObservationFacts(token);const expected=original(intent);
 for(const key of ['organizationId','workspaceId','attemptId'] as const)if(expected[key].toLowerCase()!==facts.original[key])throw Error('Observed original mismatch');
 if(expected.intentDigest!==facts.original.intentDigest||intent.task.state!=='prepared')throw Error('Observed intent mismatch');
 return bindRuntimeAssociation({version:1,purpose:'performance',original:expected,retirementRequestDigest:intent.requestDigest,namespaceIdentity:intent.namespaceIdentity,
  taskNamespaceIdentity:intent.task.taskNamespaceIdentity,daemonId:facts.daemonId,runtimeId:facts.runtimeId,specDigest:facts.specDigest,mailboxName:facts.mailboxName},intent);
}
function reply(value:unknown,intent:RetirementIntent,expected?:RuntimeAssociation):RuntimeAssociation|null{
 const copy:unknown=JSON.parse(encodeJson(value,2048));if(!copy||typeof copy!=='object'||Array.isArray(copy))throw Error('Invalid reply');const row=copy as Record<string,unknown>;
 if(Object.keys(row).sort().join(',')!=='association,key'||encodeCanonicalJson(sourceScope(row.key),512)!==encodeCanonicalJson(scope(intent),512))throw Error('Association scope mismatch');
 const association=row.association===null?null:bindRuntimeAssociation(row.association,intent);
 if(expected&&encodeCanonicalJson(association,runtimeAssociationBytes)!==encodeCanonicalJson(expected,runtimeAssociationBytes))throw Error('Association write mismatch');return association;
}
export function createRuntimeAssociationClient(options:Options):JournalRuntimeAssociations{
 async function issue(input:RetirementIntent,token?:ObservedRuntimeAssociation):Promise<RuntimeAssociation|null>{
  let current:RetirementIntent;let expected:RuntimeAssociation|undefined;
  try{
   const pending=options.send(()=>{current=captureRetirementIntent(input);const key=scope(current);
    if(token===undefined)return {kind:'runtimeAssociationRead',key};expected=observedValue(current,token);return {kind:'runtimeAssociationCommit',json:encodeCanonicalJson(expected,runtimeAssociationBytes)};});
   const value=await pending;try{return reply(value,current!,expected);}catch{return options.invalidReply();}
  }catch(error){try{await options.settleCarrier();}catch{return await new Promise<never>(()=>{});}throw error;}
 }
 return Object.freeze({read:(input:RetirementIntent)=>issue(input),commit:async(input:RetirementIntent,token:ObservedRuntimeAssociation)=>{
  const value=await issue(input,token);if(!value)return options.invalidReply();return captureRuntimeAssociation(value);},settleCarrier:()=>options.settleCarrier()});
}
