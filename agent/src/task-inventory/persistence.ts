import { captureWindow, checkWindow } from '../runtime-retirement/window.js';
import type { Operation } from '../backends/docker/index.js';
import type { StoredCleanupPlan } from '../cleanup-control/index.js';
import { OutputFailure } from '../collection/output/ports.js';
import { observedPlan } from './observation.js';
import type { TaskPlanObservation } from './observation.js';
import type { InventoryAuthority } from './authority.js';
interface Original{active?:Promise<StoredCleanupPlan>;uncertain:boolean}
/** Metadata carrier owner; no native descriptors, unlink or quota release. */
export class PlanPersistence{
 private readonly originals=new Set<Original>();private closed=false;private closing:Promise<void>|undefined;
 constructor(private readonly options:InventoryAuthority){}
 status(){return Object.freeze({retained:this.originals.size,closed:this.closed});}
 persist(token:TaskPlanObservation,input:Operation):Promise<StoredCleanupPlan>{
  if(this.closed)return Promise.reject(new OutputFailure('closed'));
  if(this.originals.size>=2)return Promise.reject(new OutputFailure('busy'));
  const owner:Original={uncertain:false};this.originals.add(owner);
  let operation:Operation;let facts:ReturnType<typeof observedPlan>;
  const read=()=>observedPlan(token,this.options.journal.retirements,this.options.journal.cleanupPlans);
  try{operation=captureWindow(input);facts=read();}catch(error){this.originals.delete(owner);return Promise.reject(error);}
  const check=()=>{checkWindow(operation,this.closed);read();};
  const active=Promise.resolve().then(async()=>{
   check();let stored:StoredCleanupPlan;
   try{stored=await this.options.journal.cleanupPlans.store(facts.plan);}
   catch(error){
    // Rejection can precede actual worker termination; no timer/status read releases it.
    try{await this.options.journal.cleanupPlans.settleCarrier();}catch{owner.uncertain=true;}
    throw error;
   }
   check();if(stored.planIdentity!==facts.planIdentity)throw new OutputFailure('custody');return stored;
  });owner.active=active;
  void active.then(()=>this.originals.delete(owner),()=>{delete owner.active;if(!owner.uncertain)this.originals.delete(owner);});return active;
 }
 close():Promise<void>{
  if(this.closing)return this.closing;this.closed=true;
  this.closing=Promise.resolve().then(async()=>{await Promise.allSettled([...this.originals].map(owner=>owner.active));
   if(this.originals.size)throw new OutputFailure('io');});return this.closing;
 }
}
