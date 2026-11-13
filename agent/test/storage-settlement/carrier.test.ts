import { expect,it } from 'vitest';
import type { Worker } from 'node:worker_threads';
import { fixture } from './fixtures.js';
import { deferred } from '../output-collection/fixture.js';
const f=fixture();const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
function withhold(owner:Awaited<ReturnType<typeof f.open>>){
 const issued=deferred<void>();const receive=Reflect.get(owner,'receive') as (reply:unknown)=>void;let held=false;
 Reflect.set(owner,'receive',(reply:unknown)=>{
  const value=reply&&typeof reply==='object'?Reflect.get(reply,'value'):undefined;
  if(!held&&value&&typeof value==='object'&&Reflect.get(value,'state')==='settled'){held=true;issued.resolve();return;}
  receive.call(owner,reply);
 });return issued.promise;
}
it('does not release the fence while actual failed-worker termination remains held',async()=>{
 const e=await f.cleaned();const committed=withhold(e.owner);const worker=Reflect.get(e.owner,'worker') as Worker;
 const terminate=worker.terminate.bind(worker);const release=deferred<void>();const issued=deferred<void>();
 worker.terminate=()=>{issued.resolve();return release.promise.then(terminate);};
 const pending=e.owner.settlements.settle(e.observation,e.request);let done=false;void pending.then(()=>{done=true;},()=>{done=true;});
 try{
  await committed;const aborting=e.owner.abort();await issued.promise;await turn();
  expect(done).toBe(false);expect(()=>e.fence.release()).toThrow('custody');
  release.resolve();await aborting;await expect(pending).rejects.toMatchObject({code:'unavailable'});
 }finally{release.resolve();await e.owner.abort();await pending.catch(()=>{});e.fence.release();}
});
it('keeps a rejected termination sticky without granting successful settlement or fence release',async()=>{
 const e=await f.cleaned();const committed=withhold(e.owner);const worker=Reflect.get(e.owner,'worker') as Worker;
 const terminate=worker.terminate.bind(worker);worker.terminate=()=>Promise.reject(Error('synthetic termination rejection'));
 const pending=e.owner.settlements.settle(e.observation,e.request);void pending.catch(()=>{});
 try{
  await committed;await expect(e.owner.abort()).rejects.toThrow('synthetic termination rejection');
  await expect(pending).rejects.toThrow('synthetic termination rejection');expect(()=>e.fence.release()).toThrow('custody');
 }finally{
  // Reap only this test's native worker. Preserve sticky Journal/carrier/fence state.
  await terminate();f.releaseTerminated(e.owner);
 }
 expect(()=>e.fence.release()).toThrow('custody');
});
