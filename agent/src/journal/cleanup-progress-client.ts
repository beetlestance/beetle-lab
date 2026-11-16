import { encodeCanonicalJson,encodeJson } from '@beetle/contracts';
import { captureNativeCleanupPlan,nativeCleanupPlanIdentity,captureCleanupProgress,cleanupControl } from '../cleanup-control/index.js';
import type { NativeCleanupPlan,CleanupProgress,JournalCleanupProgress } from '../cleanup-control/index.js';
import type { Scope } from '../admission/index.js';
import { sourceScope } from './output-source-input.js';
import type { CleanupProgressOperation } from './cleanup-progress-protocol.js';
interface Options{send(operation:()=>CleanupProgressOperation):Promise<unknown>;invalidReply():never;settleCarrier():Promise<void>}
function reply(input:unknown,plan:NativeCleanupPlan,key:Scope){
 const raw=JSON.parse(encodeJson(input,cleanupControl.progressBytes+1024)) as unknown;
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error();const row=raw as Record<string,unknown>;
 if(Object.keys(row).sort().join(',')!=='key,planIdentity,progress'||row.planIdentity!==nativeCleanupPlanIdentity(plan)
  ||encodeCanonicalJson(sourceScope(row.key),512)!==encodeCanonicalJson(key,512))throw Error();
 return row.progress===null?null:captureCleanupProgress(row.progress,plan);
}
export function createCleanupProgressClient(options:Options):JournalCleanupProgress{
 function issue(kind:'cleanupProgressRead'|'cleanupProgressBegin'|'cleanupProgressAdvance',input:NativeCleanupPlan,next?:CleanupProgress){
  let plan:NativeCleanupPlan;let key:Scope;let expected:CleanupProgress|undefined;
  const original=options.send(()=>{plan=captureNativeCleanupPlan(input);const{intentDigest:_digest,...scope}=plan.original;void _digest;key=sourceScope(scope);
   const base={key,planIdentity:nativeCleanupPlanIdentity(plan)};
   if(kind!=='cleanupProgressAdvance')return{kind,...base};expected=captureCleanupProgress(next,plan);
   return{kind,...base,json:encodeCanonicalJson(expected,cleanupControl.progressBytes)};});
  return original.then(value=>{try{const progress=reply(value,plan,key);
   if(kind!=='cleanupProgressRead'&&!progress)throw Error();
   if(expected&&encodeCanonicalJson(progress,cleanupControl.progressBytes)!==encodeCanonicalJson(expected,cleanupControl.progressBytes))throw Error();return progress;
  }catch{return options.invalidReply();}});
 }
 return Object.freeze({read:(plan:NativeCleanupPlan)=>issue('cleanupProgressRead',plan),
  begin:async(plan:NativeCleanupPlan)=>{const result=await issue('cleanupProgressBegin',plan);if(!result)return options.invalidReply();return result;},
  advance:async(plan:NativeCleanupPlan,next:CleanupProgress)=>{const result=await issue('cleanupProgressAdvance',plan,next);if(!result)return options.invalidReply();return result;},
  settleCarrier:()=>options.settleCarrier()});
}
