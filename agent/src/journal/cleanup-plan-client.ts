import { encodeCanonicalJson, encodeJson } from '@beetle/contracts';
import { captureNativeCleanupPlan, captureStoredCleanupPlan, nativeCleanupPlanIdentity, cleanupControl } from '../cleanup-control/index.js';
import type { JournalCleanupPlans, NativeCleanupPlan, CleanupPlanKey } from '../cleanup-control/index.js';
import type { Scope } from '../admission/index.js';
import { sourceScope } from './output-source-input.js';
import type { CleanupPlanOperation } from './cleanup-plan-protocol.js';
interface Options { send(operation:()=>CleanupPlanOperation):Promise<unknown>;invalidReply():never;settleCarrier():Promise<void> }
function reply(value:unknown,key:Scope) {
  const raw=JSON.parse(encodeJson(value,cleanupControl.planBytes+1024)) as unknown;
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error();const row=raw as Record<string,unknown>;
  if(Object.keys(row).sort().join(',')!=='key,stored'||encodeCanonicalJson(sourceScope(row.key),512)!==encodeCanonicalJson(key,512))throw Error();
  if(row.stored===null)return null;const stored=captureStoredCleanupPlan(row.stored);
  const{organizationId,workspaceId,attemptId,generation}=stored.plan.original;
  if(encodeCanonicalJson({organizationId,workspaceId,attemptId,generation},512)!==encodeCanonicalJson(key,512))throw Error();return stored;
}
export function createCleanupPlanClient(options:Options):JournalCleanupPlans {
  return Object.freeze({
    store(input:NativeCleanupPlan){let key:Scope;let identity:string;
      const original=options.send(()=>{const plan=captureNativeCleanupPlan(input);const{intentDigest:_digest,...scope}=plan.original;void _digest;
        key=sourceScope(scope);identity=nativeCleanupPlanIdentity(plan);return{kind:'cleanupPlanStore',json:encodeCanonicalJson(plan,cleanupControl.planBytes)};});
      return original.then(value=>{try{const stored=reply(value,key);if(!stored||stored.planIdentity!==identity)throw Error();return stored;}catch{return options.invalidReply();}});
    },
    read(input:CleanupPlanKey){let key:Scope;return options.send(()=>({kind:'cleanupPlanRead',key:key=sourceScope(input)}))
      .then(value=>{try{return reply(value,key);}catch{return options.invalidReply();}});},
    settleCarrier:()=>options.settleCarrier(),
  });
}
