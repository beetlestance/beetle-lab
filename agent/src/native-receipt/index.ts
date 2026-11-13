import { encodeCanonicalJson } from '@beetle/contracts';
import { captureWindow,checkWindow } from '../runtime-retirement/index.js';
import type { RuntimeAbsent } from '../runtime-retirement/index.js';
import type { Operation } from '../backends/docker/index.js';
import { inventoryScope } from '../task-inventory/index.js';
import type { InventoryAuthority } from '../task-inventory/index.js';
import { nativeAbsenceFacts } from '../native-removal/index.js';
import type { NativeRemoval,NativeAbsenceObservation } from '../native-removal/index.js';
import type { StoredCleanupReceipt,NativeCleanupPlan,NativeCleanupReceipt } from '../cleanup-control/index.js';
import { OutputFailure } from '../collection/output/index.js';
import type { RemovalPorts } from '../native-removal/index.js';
interface Options extends InventoryAuthority{readonly removal:NativeRemoval}
interface Entry{active?:Promise<StoredCleanupReceipt>;uncertain:boolean;proof?:NativeAbsenceObservation;request?:{plan:NativeCleanupPlan;receipt:NativeCleanupReceipt}}
const owners=new WeakMap<object,NativeReceipt>();
/** Actual current native proof before every immutable receipt commit/replay; never a refund. */
export class NativeReceipt{
 private readonly entries=new Map<string,Entry>();private closed=false;private closing:Promise<void>|undefined;private readonly options:Options;
 constructor(options:Options){if(owners.has(options.journal.cleanupReceipts))throw new OutputFailure('busy');this.options=Object.freeze({...options});owners.set(options.journal.cleanupReceipts,this);}
 finalize(token:RuntimeAbsent,operation:Operation):Promise<StoredCleanupReceipt>{return this.finalizeWithPorts(token,operation);}
 /** Trusted private native fault seam; not exposed by bootstrap. */
 finalizeWithPorts(token:RuntimeAbsent,input:Operation,ports?:RemovalPorts):Promise<StoredCleanupReceipt>{
  if(this.closed)return Promise.reject(new OutputFailure('closed'));let id:string;
  const scope=()=>inventoryScope(this.options,token);
  try{id=encodeCanonicalJson(scope().facts.intent.request,4096);}catch(error){return Promise.reject(error);}
  const prior=this.entries.get(id);if(prior)return prior.active??Promise.reject(new OutputFailure('busy'));
  if(this.entries.size>=2)return Promise.reject(new OutputFailure('busy'));const owner:Entry={uncertain:false};this.entries.set(id,owner);
  let operation:Operation;try{operation=captureWindow(input);}catch(error){this.entries.delete(id);return Promise.reject(error);}
  const check=()=>{checkWindow(operation,this.closed);scope();};
  const active=Promise.resolve().then(async()=>{
   check();const request=scope().facts.intent.request;const{organizationId,workspaceId,attemptId,generation}=request;
   const stored=await this.metadata(()=>this.options.journal.cleanupPlans.read({organizationId,workspaceId,attemptId,generation}),owner);check();if(!stored)throw new OutputFailure('custody');
   const progress=await this.metadata(()=>this.options.journal.cleanupProgress.read(stored.plan),owner);check();if(progress?.state!=='files_absent')throw new OutputFailure('custody');
   const observed=await(ports?this.options.removal.stepWithProofAndPorts(token,operation,ports):this.options.removal.stepWithProof(token,operation));check();
   if(observed.progress.state!=='files_absent'||!observed.absence)throw new OutputFailure('custody');owner.proof=observed.absence;
   const journal=this.options.journal;const facts=nativeAbsenceFacts(observed.absence,{retirements:journal.retirements,plans:journal.cleanupPlans,progress:journal.cleanupProgress,receipts:journal.cleanupReceipts});
   check();if(facts.receipt.planIdentity!==stored.planIdentity)throw new OutputFailure('custody');owner.request={plan:facts.plan,receipt:facts.receipt};
   const result=await this.metadata(()=>journal.cleanupReceipts.commit(facts.plan,facts.receipt),owner);check();
   nativeAbsenceFacts(observed.absence,{retirements:journal.retirements,plans:journal.cleanupPlans,progress:journal.cleanupProgress,receipts:journal.cleanupReceipts});return result;
  });owner.active=active;
  void active.then(()=>this.entries.delete(id),()=>{delete owner.active;if(!owner.uncertain)this.entries.delete(id);});return active;
 }
 private async metadata<T>(issue:()=>Promise<T>,owner:Entry):Promise<T>{try{return await issue();}catch(error){
  try{await this.options.journal.cleanupReceipts.settleCarrier();}catch{owner.uncertain=true;}throw error;
 }}
 status(){return Object.freeze({retained:this.entries.size,closed:this.closed});}
 close():Promise<void>{if(this.closing)return this.closing;this.closed=true;this.closing=Promise.resolve().then(async()=>{
  await Promise.allSettled([...this.entries.values()].map(owner=>owner.active));if(this.entries.size)throw new OutputFailure('io');});return this.closing;
 }
}
