import { encodeCanonicalJson, validatePrimitive } from '@beetle/contracts';
import { captureOutputRetirementRequest, outputRetirementDigest } from '@beetle/contracts/output-retirement';
import type { RetirementRequest } from '@beetle/contracts/output-retirement';
import type { Scope } from '../admission/index.js';
import { retirementDigest } from '../retirement-values/index.js';

export class CleanupAccessError extends Error {
 constructor(readonly reason:'invalid_input'|'capacity'|'fenced'|'conflict'|'custody'){super(`Cleanup access ${reason}`);}
}
export interface CleanupLease {release():void}
declare const drained:unique symbol;
export interface SettlementObservation {readonly [drained]:true}
export interface SettlementFence {drain():Promise<SettlementObservation>;release():void;cancel():void}
interface Lease {readonly identity:object}
interface Entry {readonly key:Scope;readonly leases:Set<Lease>;fence?:Fence}
interface Fence {carrier?:boolean;resolve?:(value:SettlementObservation)=>void;reject?:(error:unknown)=>void;readonly digest:string;readonly request:RetirementRequest;drain?:Promise<SettlementObservation>;observation?:SettlementObservation}
interface Observation {readonly gate:CleanupAccess;readonly entry:Entry;readonly fence:Fence}
const observations=new WeakMap<SettlementObservation,Observation>();
const gates=new WeakMap<object,CleanupAccess>();
/** Preserve unresolved originals even when their public handles are lost. */
const activeOwners=new Set<CleanupAccess>();
function key(input:Scope):Scope{
 const {organizationId,workspaceId,attemptId,generation}=input;
 if(generation!==1||![organizationId,workspaceId,attemptId].every(id=>validatePrimitive('uuid',id).ok))throw new CleanupAccessError('invalid_input');
 return Object.freeze({organizationId,workspaceId,attemptId,generation});
}
function identity(input:Scope):string{return encodeCanonicalJson(key(input),640);}
export function cleanupAccess(owner:object):CleanupAccess{
 return CleanupAccess.forOwner(owner);
}
/** One physical Journal owner. These leases prove local drain, never native absence. */
export class CleanupAccess {
 private readonly entries=new Map<string,Entry>();private leases=0;
 private constructor(private readonly owner:object){}
 static forOwner(owner:object):CleanupAccess{
 let gate=gates.get(owner);if(!gate){gate=new CleanupAccess(owner);gates.set(owner,gate);}return gate;
 }
 private entry(input:Scope):Entry{
  const checked=key(input);const id=identity(checked);const old=this.entries.get(id);if(old)return old;
  if(this.entries.size>=64)throw new CleanupAccessError('capacity');
  const entry:Entry={key:checked,leases:new Set()};this.entries.set(id,entry);activeOwners.add(this);return entry;
 }
 private evict(entry:Entry):void{
  if(entry.fence||entry.leases.size)return;
  this.entries.delete(identity(entry.key));if(!this.entries.size)activeOwners.delete(this);
 }
 assertOpen(input:Scope):void{
  if(this.entries.get(identity(input))?.fence)throw new CleanupAccessError('fenced');
 }
 acquire(input:Scope):CleanupLease{
  if(this.leases>=256)throw new CleanupAccessError('capacity');const entry=this.entry(input);
  if(entry.fence)throw new CleanupAccessError('fenced');
  const lease:Lease={identity:{}};entry.leases.add(lease);this.leases++;
  let released=false;return Object.freeze({release:()=>{
   if(released)return;released=true;entry.leases.delete(lease);this.leases--;if(entry.fence)this.completeDrain(entry,entry.fence);this.evict(entry);
  }});
 }
 reserve(input:unknown):SettlementFence{
  const request=captureOutputRetirementRequest(input);const entry=this.entry(request);
  const digest=outputRetirementDigest(request,retirementDigest);
  if(entry.fence)throw new CleanupAccessError(entry.fence.digest===digest?'capacity':'conflict');
  if([...this.entries.values()].filter(value=>value.fence).length>=2){this.evict(entry);throw new CleanupAccessError('capacity');}
  const fence:Fence={digest,request};entry.fence=fence;let released=false;
  const current=()=>{if(released||entry.fence!==fence)throw new CleanupAccessError('custody');};
  return Object.freeze({
   drain:()=>{
    current();if(fence.drain)return fence.drain;
    fence.drain=new Promise<SettlementObservation>((resolve,reject)=>{fence.resolve=resolve;fence.reject=reject;});
    void fence.drain.catch(()=>{});this.completeDrain(entry,fence);
    return fence.drain;
   },
   release:()=>{
    current();if(entry.leases.size||fence.carrier)throw new CleanupAccessError('custody');
    released=true;this.withdraw(entry,fence);
   },
   cancel:()=>{current();if(fence.carrier)throw new CleanupAccessError('custody');released=true;this.withdraw(entry,fence);},
  });
 }
 private completeDrain(entry:Entry,fence:Fence):void{
  if(entry.fence!==fence||entry.leases.size||!fence.resolve)return;
  const observation=Object.freeze({}) as SettlementObservation;fence.observation=observation;
  observations.set(observation,{gate:this,entry,fence});const resolve=fence.resolve;
  delete fence.resolve;delete fence.reject;resolve(observation);
 }
 private withdraw(entry:Entry,fence:Fence):void{
  if(fence.observation)observations.delete(fence.observation);
  const reject=fence.reject;delete fence.resolve;delete fence.reject;
  delete entry.fence;this.evict(entry);reject?.(new CleanupAccessError('custody'));
 }
 status(){return Object.freeze({originals:this.entries.size,leases:this.leases,fences:[...this.entries.values()].filter(entry=>entry.fence).length});}
 ownCarrier(input:SettlementObservation,owner:object,expected:unknown):CleanupLease{
  this.assertDrained(input,owner,expected);const proof=observations.get(input)!;
  if(proof.fence.carrier)throw new CleanupAccessError('capacity');proof.fence.carrier=true;
  let released=false;return Object.freeze({release:()=>{if(released)return;released=true;delete proof.fence.carrier;}});
 }
 assertDrained(input:SettlementObservation,owner:object,expected:unknown):RetirementRequest{
  const proof=observations.get(input);const request=captureOutputRetirementRequest(expected);
  if(owner!==this.owner||proof?.gate!==this||proof.entry.fence!==proof.fence||proof.entry.leases.size
   ||proof.fence.digest!==outputRetirementDigest(request,retirementDigest))throw new CleanupAccessError('custody');
  return request;
 }
}
export function drainedSettlementFacts(input:SettlementObservation,owner:object,expected:unknown):RetirementRequest{
 return cleanupAccess(owner).assertDrained(input,owner,expected);
}

export function ownSettlementCarrier(input:SettlementObservation,owner:object,expected:unknown):CleanupLease{
 return cleanupAccess(owner).ownCarrier(input,owner,expected);
}
