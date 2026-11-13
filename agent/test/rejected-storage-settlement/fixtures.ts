import { fixture as noTaskFixture } from '../no-task-receipt/fixtures.js';
import { cleanupAccess } from '../../src/cleanup-access/index.js';
import { cleanedReplyDigest } from '@beetle/contracts/output-settlement';
import { noTaskPipelineReply } from '../../src/retirement-pipeline/no-task-reply.js';
import { retirementDigest } from '../../src/retirement-values/index.js';
export function fixture(){
 const f=noTaskFixture();return{...f,async cleaned(){
  const e=await f.ready();const work=e.native.finalizeWithPorts(e.token,{deadline:performance.now()+10000},e.ports);
  const result=await work.result;await work.quiesced;if(!result.ok)throw Error('Missing actual native no-task receipt');
  const reply=noTaskPipelineReply(e.request,result.stored);const fence=cleanupAccess(e.owner.retirements).reserve(e.request);const observation=await fence.drain();
  const request={version:1 as const,retirement:e.request,cleanupReplyDigest:cleanedReplyDigest(reply,e.request,retirementDigest)};
  return{...e,retirement:e.request,request,reply,fence,observation};
 }};
}
