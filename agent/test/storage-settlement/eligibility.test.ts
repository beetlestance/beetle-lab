import { expect,it } from 'vitest';
import { fixture as pipelineFixture } from '../retirement-pipeline/fixtures.js';
import { fixture } from './fixtures.js';
import { cleanupAccess } from '../../src/cleanup-access/index.js';
import type { SettlementObservation } from '../../src/cleanup-access/index.js';
const f=fixture();const p=pipelineFixture();
it('requires both the opaque local drain and exact actual committed native receipt',async()=>{
 const e=await f.cleaned();
 try{
  await expect(e.owner.settlements.settle({} as SettlementObservation,e.request)).rejects.toThrow('custody');
  await expect(e.owner.settlements.settle(e.observation,{...e.request,cleanupReplyDigest:'f'.repeat(64)})).rejects.toMatchObject({code:'conflict'});
  expect((await e.owner.get(e.key)).attemptId).toBe(e.offer.attemptId);
  expect(await e.owner.settlements.settle(e.observation,e.request)).toMatchObject({state:'settled'});
 }finally{e.fence.release();}
});
it('refuses compaction before native cleanup rather than interpreting empty local leases as absence',async()=>{
 const e=await p.pipeline();const gate=cleanupAccess(e.owner.retirements);const fence=gate.reserve(e.request);
 try{
  const observation=await fence.drain();await expect(e.owner.settlements.settle(observation,
   {version:1,retirement:e.request,cleanupReplyDigest:'f'.repeat(64)})).rejects.toMatchObject({code:'conflict'});
  expect((await e.owner.get(e.key)).attemptId).toBe(e.offer.attemptId);expect(e.effects).toHaveLength(0);
 }finally{fence.release();}
});
it('keeps never-admitted originals without a funded hold protected and unfabricated',async()=>{
 const e=await f.cleaned();const offer={...e.offer,attemptId:'00000000-0000-4000-8000-000000000998'};
 await e.owner.immutableOffer(offer);const retirement={...e.request.retirement,attemptId:offer.attemptId};
 const fence=cleanupAccess(e.owner.retirements).reserve(retirement);
 try{
  const observation=await fence.drain();await expect(e.owner.settlements.settle(observation,
   {version:1,retirement,cleanupReplyDigest:'f'.repeat(64)})).rejects.toMatchObject({code:'conflict'});
  expect(await e.owner.immutableOffer(offer)).toMatchObject({attemptId:offer.attemptId,state:'offered'});
 }finally{fence.release();e.fence.release();}
});
