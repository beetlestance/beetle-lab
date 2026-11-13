import { encodeCanonicalJson } from '@beetle/contracts';
import { captureNativeCleanupPlan,captureCleanupProgress,captureNativeCleanupReceipt,nativeCleanupPlanIdentity,cleanupControl } from '../cleanup-control/index.js';
import type { NativeCleanupPlan,CleanupProgress,JournalCleanupPlans,JournalCleanupProgress,JournalCleanupReceipts } from '../cleanup-control/index.js';
import type { JournalRetirements } from '../retirement-values/index.js';
import { runtimeAbsentFacts } from '../runtime-retirement/index.js';
import type { RuntimeAbsent } from '../runtime-retirement/index.js';
import { OutputFailure } from '../collection/output/index.js';
declare const observed:unique symbol;
export interface NativeAbsenceObservation {readonly[observed]:true}
export interface AbsencePorts {readonly retirements:JournalRetirements;readonly plans:JournalCleanupPlans;readonly progress:JournalCleanupProgress;readonly receipts:JournalCleanupReceipts}
interface Facts extends AbsencePorts{readonly json:string;readonly final:CleanupProgress;readonly runtime:RuntimeAbsent;open():boolean}
const observations=new WeakMap<object,Facts>();
export function mintNativeAbsence(input:AbsencePorts&{plan:NativeCleanupPlan;final:CleanupProgress;runtime:RuntimeAbsent;open():boolean}):NativeAbsenceObservation{
 const final=captureCleanupProgress(input.final,input.plan);if(final.state!=='files_absent')throw new OutputFailure('custody');
 const token=Object.freeze({}) as NativeAbsenceObservation;observations.set(token,{retirements:input.retirements,plans:input.plans,progress:input.progress,receipts:input.receipts,runtime:input.runtime,open:input.open,json:encodeCanonicalJson(input.plan,cleanupControl.planBytes),final:Object.freeze(final)});return token;
}
export function nativeAbsenceFacts(token:NativeAbsenceObservation,ports:AbsencePorts){
 const facts=observations.get(token);
 if(!facts||!facts.open()||facts.retirements!==ports.retirements||facts.plans!==ports.plans||facts.progress!==ports.progress||facts.receipts!==ports.receipts)throw new OutputFailure('custody');
 const runtime=runtimeAbsentFacts(facts.runtime,ports.retirements);const plan=captureNativeCleanupPlan(JSON.parse(facts.json) as unknown);const final=captureCleanupProgress(facts.final,plan);
 if(plan.retirementRequestDigest!==runtime.intent.requestDigest||plan.namespaceIdentity!==runtime.intent.namespaceIdentity)throw new OutputFailure('custody');
 const receipt=captureNativeCleanupReceipt({protocolVersion:1,purpose:'performance',retirementVersion:1,retirementRequestDigest:plan.retirementRequestDigest,
  namespaceIdentity:plan.namespaceIdentity,taskNamespaceIdentity:plan.taskNamespaceIdentity,planIdentity:nativeCleanupPlanIdentity(plan),finalProgressVersion:final.version,
  closure:'owned-task-absent-after-original-close-v1'},plan,final);return{plan,progress:final,receipt};
}
