import { expect,it } from 'vitest';
import request from '../../../contracts/fixtures/valid/output-retirement-source.json' with {type:'json'};
import { cleanupAccess,drainedSettlementFacts,ownSettlementCarrier } from '../../src/cleanup-access/index.js';
import type { SettlementObservation } from '../../src/cleanup-access/index.js';
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
it('fences synchronously, drains actual leases and binds opaque observations to owner/request/current fence',async()=>{
 const owner={};const gate=cleanupAccess(owner);expect(cleanupAccess(owner)).toBe(gate);
 const lease=gate.acquire(request);const fence=gate.reserve(request);let complete=false;
 const pending=fence.drain().then(value=>{complete=true;return value;});
 expect(()=>gate.acquire(request)).toThrow('fenced');expect(()=>fence.release()).toThrow('custody');
 await turn();expect(complete).toBe(false);lease.release();const proof=await pending;
 expect(drainedSettlementFacts(proof,owner,request)).toEqual(request);
 expect(()=>drainedSettlementFacts({} as SettlementObservation,owner,request)).toThrow('custody');
 expect(()=>drainedSettlementFacts(proof,{},request)).toThrow('custody');
 expect(()=>drainedSettlementFacts(proof,owner,{...request,runId:request.attemptId})).toThrow('custody');
 expect(gate.status()).toEqual({originals:1,leases:0,fences:1});fence.release();
 expect(()=>drainedSettlementFacts(proof,owner,request)).toThrow('custody');expect(gate.status().originals).toBe(0);
});
it('keeps unrelated originals independent and bounds fences/originals/leases before growing ownership',async()=>{
 const gate=cleanupAccess({});const other={...request,attemptId:'00000000-0000-4000-8000-000000000099'};
 const first=gate.reserve(request);const lease=gate.acquire(other);const second=gate.reserve(other);
 expect(()=>gate.reserve({...other,attemptId:'00000000-0000-4000-8000-000000000098'})).toThrow('capacity');
 expect(()=>gate.reserve({...request,runId:other.attemptId})).toThrow('conflict');
 expect(()=>gate.reserve(request)).toThrow('capacity');await first.drain();first.release();
 lease.release();await second.drain();second.release();expect(gate.status().originals).toBe(0);
 const leases=Array.from({length:256},()=>gate.acquire(request));expect(()=>gate.acquire(request)).toThrow('capacity');
 for(const value of leases)value.release();
 const owners=Array.from({length:64},(_,n)=>gate.acquire({...request,attemptId:`00000000-0000-4000-8000-${n.toString().padStart(12,'0')}`}));
 expect(()=>gate.acquire(other)).toThrow('capacity');for(const value of owners)value.release();expect(gate.status().leases).toBe(0);
});
it('retains an unresolved original without treating caller abandonment as drain',async()=>{
 const gate=cleanupAccess({});const lease=gate.acquire(request);const fence=gate.reserve(request);let done=false;
 void fence.drain().then(()=>{done=true;});await turn();expect(done).toBe(false);
 expect(gate.status()).toEqual({originals:1,leases:1,fences:1});expect(()=>fence.release()).toThrow('custody');
 lease.release();await fence.drain();fence.release();
});

it('cancels only unissued fences and detaches each pending waiter from held native custody',async()=>{
 const owner={};const gate=cleanupAccess(owner);const lease=gate.acquire(request);
 for(let n=0;n<256;n++){
  const fence=gate.reserve(request);const drained=fence.drain();fence.cancel();
  await expect(drained).rejects.toThrow('custody');
  expect(gate.status()).toEqual({originals:1,leases:1,fences:0});
 }
 lease.release();expect(gate.status().originals).toBe(0);
 const fence=gate.reserve(request);const proof=await fence.drain();fence.cancel();
 expect(()=>drainedSettlementFacts(proof,owner,request)).toThrow('custody');
 const issued=gate.reserve(request);const issuedProof=await issued.drain();const carrier=ownSettlementCarrier(issuedProof,owner,request);
 expect(()=>issued.cancel()).toThrow('custody');expect(()=>issued.release()).toThrow('custody');
 expect(drainedSettlementFacts(issuedProof,owner,request)).toEqual(request);
 carrier.release();issued.release();expect(gate.status().originals).toBe(0);
});
