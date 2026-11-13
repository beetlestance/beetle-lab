import { expect,it } from 'vitest';
import { fixture } from '../retirement-pipeline/fixtures.js';
import { cleanupAccess } from '../../src/cleanup-access/index.js';
import { cleanedReplyDigest } from '@beetle/contracts/output-settlement';
import { retirementDigest } from '../../src/retirement-values/index.js';
const f=fixture();const operation=()=>({deadline:performance.now()+10000});
it('atomically transfers a genuine cleaned admitted hold and replays from only its permanent tombstone',async()=>{
 const e=await f.pipeline(16,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');const work=e.pipeline.tickWithPorts(e.request,operation(),e.ports);
 const cleaned=await work.result;await work.settled;expect(cleaned.state).toBe('cleaned');
 const gate=cleanupAccess(e.owner.retirements);const fence=gate.reserve(e.request);
 try{
  const observation=await fence.drain();const request={version:1,retirement:e.request,
   cleanupReplyDigest:cleanedReplyDigest(cleaned,e.request,retirementDigest)};
  const result=await e.owner.settlements.settle(observation,request);expect(result).toMatchObject({state:'settled',chargedBytes:4096});
  expect(await e.owner.settlements.settle(observation,request)).toEqual(result);
  expect(await e.owner.settlements.retiredReply(e.request)).toEqual(cleaned);
  await expect(e.owner.get(e.key)).rejects.toMatchObject({code:'conflict'});
  await expect(e.owner.immutableOffer(e.offer)).rejects.toMatchObject({code:'conflict'});
  await expect(e.owner.cancelOriginal({offer:e.offer,now:Date.now()})).rejects.toMatchObject({code:'conflict'});
  await expect(e.owner.immutableOffer({...e.offer,attemptId:e.offer.attemptId.toUpperCase()})).rejects.toMatchObject({code:'conflict'});
 }finally{fence.release();}
 const before={effects:e.effects.length,opened:e.opened.length,docker:e.docker.calls.length};
 const replay=e.pipeline.tickWithPorts(e.request,operation(),e.ports);
 expect(await replay.result).toEqual(cleaned);await replay.settled;
 expect({effects:e.effects.length,opened:e.opened.length,docker:e.docker.calls.length}).toEqual(before);
});
