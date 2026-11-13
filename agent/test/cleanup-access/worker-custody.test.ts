import { expect,it } from 'vitest';
import type { Worker } from 'node:worker_threads';
import { fixture } from '../runtime-retirement/fixtures.js';
import { producerBarrierFacts } from '../../src/producer-retirement/index.js';
import { cleanupAccess } from '../../src/cleanup-access/index.js';
import { deferred } from '../output-collection/fixture.js';
const f=fixture();const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
it('keeps runtime metadata custody through the actual compiled worker termination after an unavailable worker reply',async()=>{
 const e=await f.ready();const worker=Reflect.get(e.owner,'worker') as Worker;
 const terminate=worker.terminate.bind(worker);const release=deferred<void>();const issued=deferred<void>();
 worker.terminate=()=>{issued.resolve();return release.promise.then(terminate);};
 const receive=Reflect.get(e.owner,'receive') as (reply:unknown)=>void;let changed=false;
 Reflect.set(e.owner,'receive',(reply:unknown)=>{
  const value=reply&&typeof reply==='object'?Reflect.get(reply,'value'):undefined;
  if(!changed&&value&&typeof value==='object'&&Reflect.has(value,'intent')){
   changed=true;receive.call(e.owner,{id:Reflect.get(reply as object,'id'),ok:false,code:'unavailable'});return;
  }
  receive.call(e.owner,reply);
 });
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
 let settled=false;const work=e.runtime.retire(e.producer,{deadline:performance.now()+10000});
 void work.then(()=>{settled=true;},()=>{settled=true;});await Promise.race([issued.promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Worker termination was not issued')),2000);})]);
 const request=producerBarrierFacts(e.producer,e.owner.retirements).intent.request;
 const gate=cleanupAccess(e.owner.retirements);const fence=gate.reserve(request);let drained=false;
 const pending=fence.drain().then(value=>{drained=true;return value;});await turn();
 expect(settled).toBe(false);expect(drained).toBe(false);expect(gate.status().leases).toBe(1);expect(e.docker.calls).toHaveLength(0);
 release.resolve();await expect(work).rejects.toBeTruthy();await pending;fence.release();expect(changed).toBe(true);
 }finally{clearTimeout(timer);release.resolve();worker.terminate=terminate;await e.owner.abort();}
});
