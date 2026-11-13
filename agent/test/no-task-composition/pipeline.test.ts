import { expect,it } from 'vitest';
import { cleanupAccess } from '../../src/cleanup-access/index.js';
import { cleanedReplyDigest } from '@beetle/contracts/output-settlement';
import { retirementDigest } from '../../src/retirement-values/index.js';
import { fixture } from './fixtures.js';
const f=fixture();
it('runs actual installation producer drain, no-task proof and private worker settlement through the composed pipeline',async()=>{
 const e=await f.composed();const work=e.pipeline.tickWithPorts(e.request,{deadline:performance.now()+10000},e.ports);
 const reply=await work.result;await work.settled;expect(reply.state).toBe('cleaned');expect(e.docker.calls).toHaveLength(8);
 expect(e.docker.calls.every(call=>call.method==='GET')).toBe(true);
 const fence=cleanupAccess(e.owner.retirements).reserve(e.request);const observation=await fence.drain();
 const request={version:1 as const,retirement:e.request,cleanupReplyDigest:cleanedReplyDigest(reply,e.request,retirementDigest)};
 expect((await e.owner.settlements.settle(observation,request)).chargedBytes).toBe(4096);fence.release();
 const replay=e.pipeline.tickWithPorts(e.request,{deadline:performance.now()+10000},e.ports);expect(await replay.result).toEqual(reply);await replay.settled;
 expect(e.docker.calls).toHaveLength(8);
});
it('stops no-task proof dispatch on pipeline close while joining an actual late root open',async()=>{
 const e=await f.composed();let opened!:()=>void;let release!:()=>void;const issued=new Promise<void>(resolve=>{opened=resolve;});const held=new Promise<void>(resolve=>{release=resolve;});
 const ports={...e.ports,noTask:{...e.ports.noTask,filesystem:{...e.ports.noTask.filesystem,open:async(...args:Parameters<typeof e.ports.noTask.filesystem.open>)=>{
  opened();await held;return e.ports.noTask.filesystem.open(...args);
 }}}};
 const work=e.pipeline.tickWithPorts(e.request,{deadline:performance.now()+10000},ports);await issued;let done=false;
 const closing=e.pipeline.close().then(()=>{done=true;});expect(e.noTask.status().closed).toBe(true);await Promise.resolve();expect(done).toBe(false);
 release();await expect(work.result).rejects.toMatchObject({reason:'closed'});await expect(work.settled).rejects.toMatchObject({reason:'closed'});await closing;
 expect(e.docker.calls).toHaveLength(0);expect(e.closed.length).toBe(e.opened.length);expect(e.pipeline.status().retained).toBe(0);
});
