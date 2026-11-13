import { expect,it } from 'vitest';
import { encodeCanonicalJson,encodeJson } from '@beetle/contracts';
import { cleanupPlanFrameBytes,cleanupControl,nativeCleanupPlanIdentity,captureNativeCleanupPlan } from '../../src/cleanup-control/index.js';
import type { NativeCleanupPlan,CleanupEntry } from '../../src/cleanup-control/index.js';
import { createCleanupPlanClient } from '../../src/journal/cleanup-plan-client.js';
import { plan as fixturePlan,file } from '../cleanup-control/fixture.js';
it.each(['"','🪲"'] as const)('bounds an almost full quote/Unicode plan through the escaped original carrier: %s',async fragment=>{
 const base=fixturePlan();const entries:CleanupEntry[]=[...base.entries];let last:NativeCleanupPlan=base;
 for(let n=0;n<500;n++){
  entries.push({path:`input/${String(n).padStart(3,'0')}-${fragment.repeat(80)}`,kind:'file',native:{...file,ino:String(n+100)}});
  const candidate={...base,entries:[...entries].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)};
  try{last=captureNativeCleanupPlan(candidate);}catch{break;}
 }
 expect(Buffer.byteLength(encodeCanonicalJson(last,cleanupControl.planBytes))).toBeGreaterThan(120000);
 let bytes=0;const{intentDigest:_ignored,...key}=last.original;void _ignored;
 const client=createCleanupPlanClient({send:async factory=>{const command=factory();bytes=Buffer.byteLength(encodeJson({id:1,...command},cleanupPlanFrameBytes));
  return{key,stored:{plan:last,planIdentity:nativeCleanupPlanIdentity(last)}};},invalidReply:()=>{throw Error('invalid reply');},settleCarrier:async()=>undefined});
 expect((await client.store(last)).planIdentity).toBe(nativeCleanupPlanIdentity(last));expect(bytes).toBeLessThanOrEqual(cleanupPlanFrameBytes);
});
it.each(['foreign-null','foreign-plan','digest','fields'] as const)('rejects crossed or corrupted %s replies',async mode=>{
 const plan=fixturePlan();const{intentDigest:_ignored,...key}=plan.original;void _ignored;let invalid=0;
 const value={key:mode==='foreign-null'?{...key,workspaceId:plan.original.attemptId}:key,
  stored:mode==='foreign-null'?null:{plan:mode==='foreign-plan'?{...plan,original:{...plan.original,workspaceId:plan.original.attemptId}}:plan,
   planIdentity:mode==='digest'?'f'.repeat(64):nativeCleanupPlanIdentity(plan)},...(mode==='fields'?{open:true}:{})};
 const client=createCleanupPlanClient({send:async factory=>{factory();return value;},invalidReply:()=>{invalid++;throw Error('invalid reply');},settleCarrier:async()=>undefined});
 await expect(client.read(key)).rejects.toThrow('invalid reply');expect(invalid).toBe(1);
});
