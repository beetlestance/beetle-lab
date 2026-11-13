import { encodeCanonicalJson,encodeJson } from '@beetle/contracts';
import { captureNativeCleanupPlan,nativeCleanupPlanIdentity,captureNativeCleanupReceipt,nativeCleanupReceiptIdentity,captureStoredCleanupReceipt,finalCleanupProgress,cleanupControl } from '../cleanup-control/index.js';
import type { NativeCleanupPlan,NativeCleanupReceipt,JournalCleanupReceipts } from '../cleanup-control/index.js';
import type { Scope } from '../admission/index.js';
import { sourceScope } from './output-source-input.js';
import type { CleanupReceiptOperation } from './cleanup-receipt-protocol.js';
interface Options{send(operation:()=>CleanupReceiptOperation):Promise<unknown>;invalidReply():never;settleCarrier():Promise<void>}
function reply(value:unknown,plan:NativeCleanupPlan,key:Scope){
 const raw=JSON.parse(encodeJson(value,cleanupControl.receiptBytes+1024)) as unknown;if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error();const row=raw as Record<string,unknown>;
 if(Object.keys(row).sort().join(',')!=='key,planIdentity,stored'||row.planIdentity!==nativeCleanupPlanIdentity(plan)||encodeCanonicalJson(sourceScope(row.key),512)!==encodeCanonicalJson(key,512))throw Error();
 return row.stored===null?null:captureStoredCleanupReceipt(row.stored,plan);
}
export function createCleanupReceiptClient(options:Options):JournalCleanupReceipts{
 function issue(kind:'cleanupReceiptRead'|'cleanupReceiptCommit',input:NativeCleanupPlan,receipt?:NativeCleanupReceipt){
  let plan:NativeCleanupPlan;let key:Scope;let expected:string|undefined;
  const original=options.send(()=>{plan=captureNativeCleanupPlan(input);const{intentDigest:_digest,...scope}=plan.original;void _digest;key=sourceScope(scope);const base={key,planIdentity:nativeCleanupPlanIdentity(plan)};
   if(kind==='cleanupReceiptRead')return{kind,...base};const value=captureNativeCleanupReceipt(receipt,plan,finalCleanupProgress(plan));expected=nativeCleanupReceiptIdentity(value);
   return{kind,...base,json:encodeCanonicalJson(value,cleanupControl.receiptBytes)};});
  return original.then(value=>{try{const stored=reply(value,plan,key);if(expected&&stored?.receiptIdentity!==expected)throw Error();return stored;}catch{return options.invalidReply();}});
 }
 return Object.freeze({read:(plan:NativeCleanupPlan)=>issue('cleanupReceiptRead',plan),commit:async(plan:NativeCleanupPlan,receipt:NativeCleanupReceipt)=>{
  const stored=await issue('cleanupReceiptCommit',plan,receipt);if(!stored)return options.invalidReply();return stored;},settleCarrier:()=>options.settleCarrier()});
}
