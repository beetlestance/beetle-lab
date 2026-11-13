import { expect,it } from 'vitest';
import type { Worker } from 'node:worker_threads';
import { fixture } from '../storage-settlement/fixtures.js';
import { deferred } from '../output-collection/fixture.js';
import { cleanupAccess } from '../../src/cleanup-access/index.js';
import { StorageSettlement } from '../../src/storage-settlement/index.js';
const f=fixture();
it.each(['eligible','settled'] as const)('preserves a rejected %s carrier termination without converting cancellation into release',async state=>{
 const e=await f.cleaned();e.fence.release();const service=new StorageSettlement({journal:e.owner});
 const issued=deferred<void>();const receive=Reflect.get(e.owner,'receive') as (reply:unknown)=>void;
 Reflect.set(e.owner,'receive',(reply:unknown)=>{
  const value=reply&&typeof reply==='object'?Reflect.get(reply,'value'):undefined;
  if(value&&typeof value==='object'&&Reflect.get(value,'state')===state){issued.resolve();return;}
  receive.call(e.owner,reply);
 });
 const worker=Reflect.get(e.owner,'worker') as Worker;const terminate=worker.terminate.bind(worker);
 worker.terminate=()=>Promise.reject(Error('synthetic termination rejection'));
 const work=service.settle(e.request,{deadline:performance.now()+10000});
 try{
  await issued.promise;service.stop();await expect(e.owner.abort()).rejects.toThrow('synthetic termination rejection');
  await expect(work.result).rejects.toThrow('synthetic termination rejection');await expect(work.settled).rejects.toBeDefined();
  await expect(service.close()).rejects.toMatchObject({reason:'unavailable'});expect(service.status().retained).toBe(1);
  expect(cleanupAccess(e.owner.retirements).status().fences).toBe(state==='settled'?1:0);
 }finally{
  // Reap this fixture's native worker; sticky service/Journal ownership remains failed.
  await terminate();f.releaseTerminated(e.owner);
 }
 expect(service.status().retained).toBe(1);
});
