import {encodeCanonicalJson,encodeJson,validatePrimitive} from '@beetle/contracts';
import type {CleanupOriginal} from '../cleanup-control/index.js';
import type {RetirementIntent} from '../retirement-values/index.js';
export interface RuntimeAssociation {
 readonly version:1;readonly purpose:'performance';readonly original:CleanupOriginal;
 readonly retirementRequestDigest:string;readonly namespaceIdentity:string;readonly taskNamespaceIdentity:string;
 readonly daemonId:string;readonly runtimeId:string;readonly specDigest:string;readonly mailboxName:string;
}
declare const observed:unique symbol;
/** Minted only by the Docker owner after exact stopped-runtime and volume inspection. */
export interface ObservedRuntimeAssociation {readonly [observed]:true}
export interface RuntimeAssociationObservation {
 readonly original:CleanupOriginal;readonly daemonId:string;readonly runtimeId:string;readonly specDigest:string;readonly mailboxName:string;
}
export interface JournalRuntimeAssociations {
 read(intent:RetirementIntent):Promise<RuntimeAssociation|null>;
 commit(intent:RetirementIntent,observed:ObservedRuntimeAssociation):Promise<RuntimeAssociation>;
 settleCarrier():Promise<void>;
}
export const runtimeAssociationBytes=1536;
function requireFact(value:unknown):asserts value{if(!value)throw Error('Invalid runtime association');}
function closed(value:unknown,fields:readonly string[]):Record<string,unknown>{
 requireFact(value&&typeof value==='object'&&!Array.isArray(value));const row=value as Record<string,unknown>;
 requireFact(Object.keys(row).length===fields.length&&fields.every(field=>Object.hasOwn(row,field)));return row;
}
export function captureRuntimeAssociation(input:unknown):RuntimeAssociation{
 const copy:unknown=JSON.parse(encodeJson(input,runtimeAssociationBytes));
 const row=closed(copy,['version','purpose','original','retirementRequestDigest','namespaceIdentity','taskNamespaceIdentity','daemonId','runtimeId','specDigest','mailboxName']);
 const original=closed(row.original,['organizationId','workspaceId','attemptId','generation','intentDigest']);
 for(const key of ['organizationId','workspaceId','attemptId'])requireFact(validatePrimitive('uuid',original[key]).ok);
 requireFact(original.generation===1&&row.version===1&&row.purpose==='performance');
 for(const value of [original.intentDigest,row.retirementRequestDigest,row.namespaceIdentity,row.taskNamespaceIdentity,row.runtimeId,row.specDigest])requireFact(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value));
 requireFact(typeof row.daemonId==='string'&&/^[A-Za-z0-9:._-]{1,128}$/.test(row.daemonId));
 requireFact(typeof row.mailboxName==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(row.mailboxName));
 Object.freeze(original);return Object.freeze(row) as unknown as RuntimeAssociation;
}
/** Stored syntax is not native proof; the caller must retain original retirement authority. */
export function bindRuntimeAssociation(input:unknown,intent:RetirementIntent):RuntimeAssociation{
 const value=captureRuntimeAssociation(input);const request=intent.request;
 const original={organizationId:request.organizationId,workspaceId:request.workspaceId,attemptId:request.attemptId,generation:request.generation,intentDigest:request.intentDigest};
 requireFact(encodeCanonicalJson(value.original,512)===encodeCanonicalJson(original,512));
 requireFact(intent.task.state==='prepared'&&value.retirementRequestDigest===intent.requestDigest&&value.namespaceIdentity===intent.namespaceIdentity&&value.taskNamespaceIdentity===intent.task.taskNamespaceIdentity);
 return value;
}
