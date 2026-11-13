import { encodeCanonicalJson } from '@beetle/contracts';
import { captureWindow,checkWindow } from '../runtime-retirement/index.js';
import type { RuntimeAbsent } from '../runtime-retirement/index.js';
import type { Operation } from '../backends/docker/index.js';
import type { CleanupProgress } from '../cleanup-control/index.js';
import { inventoryScope,inventoryAnchor } from '../task-inventory/index.js';
import type { InventoryAuthority } from '../task-inventory/index.js';
import { OutputFailure } from '../collection/output/index.js';
import type { OutputIO } from '../collection/output/index.js';
import { startNativeStep } from './operation.js';
import type { NativeStep } from './types.js';
import type { RemovalPorts } from './files.js';
interface Entry{active?:Promise<CleanupProgress>;native?:NativeStep;uncertain:boolean}
const owners=new WeakMap<object,NativeRemoval>();
/** Exactly one reverse-plan removal per call, serialized through actual carrier settlement. */
export class NativeRemoval{
 private readonly entries=new Map<string,Entry>();private closed=false;private closing:Promise<void>|undefined;private readonly options:InventoryAuthority;
 constructor(options:InventoryAuthority){if(owners.has(options.journal.retirements))throw new OutputFailure('busy');this.options=Object.freeze({...options});owners.set(options.journal.retirements,this);}
 step(token:RuntimeAbsent,operation:Operation):Promise<CleanupProgress>{return this.stepWithPorts(token,operation);}
 /** Trusted private fault seam, never exposed by bootstrap. */
 stepWithPorts(token:RuntimeAbsent,input:Operation,ports?:RemovalPorts):Promise<CleanupProgress>{
  if(this.closed)return Promise.reject(new OutputFailure('closed'));let id:string;
  try{id=encodeCanonicalJson(inventoryScope(this.options,token).facts.intent.request,4096);}catch(error){return Promise.reject(error);}
  const prior=this.entries.get(id);if(prior)return prior.active??Promise.reject(new OutputFailure('io'));
  if(this.entries.size>=64)return Promise.reject(new OutputFailure('busy'));const owner:Entry={uncertain:false};this.entries.set(id,owner);
  let operation:Operation;try{operation=captureWindow(input);}catch(error){this.entries.delete(id);return Promise.reject(error);}
  const check=()=>{checkWindow(operation,this.closed);inventoryScope(this.options,token);};
  const active=Promise.resolve().then(async()=>{
   check();const io:OutputIO={check,own:()=>{throw new OutputFailure('io');},closeHandles:async()=>{throw new OutputFailure('io');},
    io:async action=>{check();const value=await action();check();return value;}};
   const scope=await inventoryAnchor(this.options,token,io);check();const{organizationId,workspaceId,attemptId,generation}=scope.facts.intent.request;
   const stored=await this.metadata(()=>this.options.journal.cleanupPlans.read({organizationId,workspaceId,attemptId,generation}),owner);check();
   if(!stored||stored.plan.retirementRequestDigest!==scope.facts.intent.requestDigest||stored.plan.taskNamespaceIdentity!==scope.anchor.taskNamespaceIdentity)throw new OutputFailure('custody');
   const progress=await this.metadata(()=>this.options.journal.cleanupProgress.begin(stored.plan),owner);check();
   const native=startNativeStep({directory:scope.directory,root:scope.anchor.directories.task,installation:scope.root,plan:stored.plan,progress,operation,check,prepareCleaning:()=>this.metadata(()=>this.options.journal.cleanupProgress.advance(stored.plan,{...progress,state:'cleaning',version:2}),owner)},ports);owner.native=native;
   const result=await native.result;await native.quiesced;
   try{await native.close();}catch(error){owner.uncertain=true;throw error;}check();if(!result.ok)throw new OutputFailure(result.reason);
   const advanced=await this.metadata(()=>this.options.journal.cleanupProgress.advance(stored.plan,result.progress),owner);check();return advanced;
  });owner.active=active;
  void active.then(()=>this.entries.delete(id),()=>{delete owner.active;if(!owner.uncertain)this.entries.delete(id);});return active;
 }
 private async metadata<T>(issue:()=>Promise<T>,owner:Entry):Promise<T>{
  try{return await issue();}catch(error){try{await this.options.journal.cleanupProgress.settleCarrier();}catch{owner.uncertain=true;}throw error;}
 }
 status(){return Object.freeze({retained:this.entries.size,closed:this.closed});}
 close():Promise<void>{if(this.closing)return this.closing;this.closed=true;
  this.closing=Promise.resolve().then(async()=>{await Promise.allSettled([...this.entries.values()].map(owner=>owner.active));if(this.entries.size)throw new OutputFailure('io');});return this.closing;
 }
}
