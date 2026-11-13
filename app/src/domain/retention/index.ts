import { encodeJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { RetentionPolicy } from '@beetle/contracts/api';
import { requireRule } from '../namespaces/index.js';

export interface RetentionPrefix {readonly completedCount:number;readonly logicalBytes:number|null}
export interface RetentionFact {
 readonly requestedAt:string;readonly completed:boolean;
 readonly logicalBytes:number|null;
 readonly protection:'none'|'pinned'|'unknown'|'cleanup_in_progress';
}
export type RetentionReason='age'|'completed_count'|'storage_budget';
export interface RetentionDecision {
 readonly reason:RetentionReason|null;
 readonly excluded:Exclude<RetentionFact['protection'],'none'>|'active'|null;
}
function integer(value:unknown):asserts value is number{requireRule(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0);}
function nullableBytes(value:unknown):asserts value is number|null{if(value!==null)integer(value);}
function fields(value:unknown,names:readonly string[]):asserts value is Record<string,unknown>{
 requireRule(value!==null&&typeof value==='object'&&!Array.isArray(value));
 requireRule(Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name)));
}
function capturePrefix(input:unknown):RetentionPrefix{
 fields(input,['completedCount','logicalBytes']);integer(input.completedCount);nullableBytes(input.logicalBytes);
 return{completedCount:input.completedCount,logicalBytes:input.logicalBytes};
}
function captureFact(input:unknown):RetentionFact{
 fields(input,['requestedAt','completed','logicalBytes','protection']);
 requireRule(typeof input.requestedAt==='string'&&input.requestedAt.length===24&&Number.isFinite(Date.parse(input.requestedAt)));
 requireRule(new Date(input.requestedAt).toISOString()===input.requestedAt&&typeof input.completed==='boolean');nullableBytes(input.logicalBytes);
 requireRule(['none','pinned','unknown','cleanup_in_progress'].includes(input.protection as string));
 requireRule(input.logicalBytes!==null||input.protection==='unknown'||!input.completed);
 return input as unknown as RetentionFact;
}
function sum(left:number,right:number):number{requireRule(left<=Number.MAX_SAFE_INTEGER-right);return left+right;}
function advance(prefix:RetentionPrefix,fact:RetentionFact):RetentionPrefix{
 if(!fact.completed)return prefix;
 return{completedCount:sum(prefix.completedCount,1),logicalBytes:prefix.logicalBytes===null||fact.logicalBytes===null?null:sum(prefix.logicalBytes,fact.logicalBytes)};
}
function protection(fact:RetentionFact):RetentionDecision['excluded']{
 if(!fact.completed)return 'active';return fact.protection==='none'?null:fact.protection;
}
function decide(policy:RetentionPolicy,prefix:RetentionPrefix,fact:RetentionFact,now:number):RetentionDecision{
 const excluded=protection(fact);
 if(excluded!==null||policy.mode==='manual')return{reason:null,excluded};
 // Age uses immutable request time; active work is excluded regardless of its age.
 if(policy.ageDays!==undefined&&Date.parse(fact.requestedAt)<=now-policy.ageDays*86400000)return{reason:'age',excluded:null};
 if(policy.completedRunCount!==undefined&&prefix.completedCount>policy.completedRunCount)return{reason:'completed_count',excluded:null};
 if(policy.storageBytes!==undefined&&prefix.logicalBytes!==null&&prefix.logicalBytes>policy.storageBytes)return{reason:'storage_budget',excluded:null};
 return{reason:null,excluded:null};
}
/** Pure bounded newest-first window. Facts/prefix are caller-owned metadata, never cleanup authority.
 * Unknown completed byte debt poisons storage selection for the remaining prefix.
 * Protected completed runs still consume the retained count and known logical budget.
 */
export function evaluateRetentionWindow(input:{readonly policy:RetentionPolicy;readonly prefix:RetentionPrefix;readonly facts:readonly RetentionFact[];readonly now:number}){
 const value:unknown=JSON.parse(encodeJson(input,32768));fields(value,['policy','prefix','facts','now']);
 const policy=validateApi('RetentionPolicy',value.policy);requireRule(policy.ok);integer(value.now);requireRule(value.now<=8640000000000000);
 requireRule(Array.isArray(value.facts)&&value.facts.length<=100);let prefix=capturePrefix(value.prefix);
 const decisions:RetentionDecision[]=[];
 for(const inputFact of value.facts){const fact=captureFact(inputFact);prefix=advance(prefix,fact);decisions.push(decide(policy.value,prefix,fact,value.now));}
 return Object.freeze({prefix:Object.freeze(prefix),decisions:Object.freeze(decisions.map(decision=>Object.freeze(decision)))});
}
