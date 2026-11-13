import { encodeCanonicalJson } from '@beetle/contracts';
import { captureNativeCleanupPlan, nativeCleanupPlanIdentity, cleanupControl } from '../cleanup-control/index.js';
import type { NativeCleanupPlan, JournalCleanupPlans } from '../cleanup-control/index.js';
import { runtimeAbsentFacts } from '../runtime-retirement/index.js';
import type { RuntimeAbsent } from '../runtime-retirement/index.js';
import type { JournalRetirements } from '../retirement-values/index.js';
import { requireInventory } from './checks.js';
declare const observed:unique symbol;
/** Genuine post-close C3c observation, still no deletion permission. */
export interface TaskPlanObservation {readonly[observed]:true}
interface Facts {readonly json:string;readonly planIdentity:string;readonly runtime:RuntimeAbsent;
 readonly retirement:JournalRetirements;readonly plans:JournalCleanupPlans;open():boolean}
const observations=new WeakMap<object,Facts>();
export function mintObservation(input:{plan:NativeCleanupPlan;runtime:RuntimeAbsent;retirement:JournalRetirements;plans:JournalCleanupPlans;open():boolean}):TaskPlanObservation{
 const token=Object.freeze({}) as TaskPlanObservation;
 observations.set(token,{json:encodeCanonicalJson(input.plan,cleanupControl.planBytes),planIdentity:nativeCleanupPlanIdentity(input.plan),
  runtime:input.runtime,retirement:input.retirement,plans:input.plans,open:input.open});return token;
}
export function observedPlan(token:TaskPlanObservation,retirement:JournalRetirements,plans:JournalCleanupPlans){
 const facts=observations.get(token);requireInventory(facts&&facts.open()&&facts.retirement===retirement&&facts.plans===plans);
 const runtime=runtimeAbsentFacts(facts.runtime,retirement);const plan=captureNativeCleanupPlan(JSON.parse(facts.json) as unknown);
 requireInventory(plan.retirementRequestDigest===runtime.intent.requestDigest&&plan.namespaceIdentity===runtime.intent.namespaceIdentity
  &&nativeCleanupPlanIdentity(plan)===facts.planIdentity);
 return Object.freeze({plan,planIdentity:facts.planIdentity});
}
