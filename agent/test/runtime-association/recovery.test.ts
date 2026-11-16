import {expect,it} from 'vitest';
import {DockerBackend} from '../../src/backends/docker/index.js';
import {runtimeAbsentFacts} from '../../src/runtime-retirement/index.js';
import {producerBarrierFacts} from '../../src/producer-retirement/index.js';
import {fixture} from '../runtime-retirement/fixtures.js';
import {operation} from '../staging/fixtures.js';
import {unavailable} from '../backends/docker/fixtures.js';
const f=fixture();
it('durably binds the actual observed original before container DELETE and recovers a cold backend after lost deletion reply',async()=>{
 const e=await f.ready(true);const intent=producerBarrierFacts(e.producer,e.owner.retirements).intent;const before=await e.owner.get(e.key);
 let seen=false;e.docker.intercept=async input=>{
  if(input.method==='DELETE'&&input.path.startsWith('/v1.47/containers/')){
   const association=await e.owner.runtimeAssociations.read(intent);expect(association).toMatchObject({daemonId:e.configuration.expectedDaemonId,runtimeId:'b'.repeat(64),specDigest:e.plan.specDigest,mailboxName:`${e.plan.name}-live`});
   seen=true;e.docker.state=undefined;return unavailable();
  }return e.docker.respond(input);
 };
 await expect(e.runtime.retire(e.producer,operation())).rejects.toMatchObject({reason:'unresolved'});expect(seen).toBe(true);expect(e.docker.volume).toBeDefined();e.docker.intercept=undefined;
 // New backend has no in-memory seen association; only actual Journal read can restore it.
 const cold=new DockerBackend(e.docker);const result=await cold.removeRetired(e.plan,operation(),{runtimeId:'b'.repeat(64),daemonId:e.configuration.expectedDaemonId},
  {read:()=>e.owner.runtimeAssociations.read(intent),commit:observed=>e.owner.runtimeAssociations.commit(intent,observed)});
 expect(result).toEqual({outcome:'known',value:'removed'});expect(e.docker.volume).toBeUndefined();
 expect(await e.owner.get(e.key)).toEqual(before);const token=await e.runtime.retire(e.producer,operation());expect(runtimeAbsentFacts(token,e.owner.retirements).runtime.kind).toBe('absent');
});
it('holds container deletion until the actual association write returns and never deletes after cancellation',async()=>{
 const e=await f.ready(true);let release!:()=>void;let enter!:()=>void;const entered=new Promise<void>(resolve=>{enter=resolve;});const gate=new Promise<void>(resolve=>{release=resolve;});
 const original=e.owner.runtimeAssociations;Reflect.set(e.owner,'runtimeAssociations',{...original,commit:async(...args:Parameters<typeof original.commit>)=>{enter();await gate;return original.commit(...args);}});
 const abort=new AbortController();const work=e.runtime.retire(e.producer,{...operation(),signal:abort.signal});const failed=expect(work).rejects.toBeTruthy();
 try{await entered;expect(e.docker.mutations()).toHaveLength(0);abort.abort();release();await failed;expect(e.docker.mutations()).toHaveLength(0);}
 finally{release();Reflect.set(e.owner,'runtimeAssociations',original);}
});
it('does not delete when association persistence rejects and refuses fabricated observation tokens',async()=>{
 const e=await f.ready(true);const intent=producerBarrierFacts(e.producer,e.owner.retirements).intent;
 await expect(e.owner.runtimeAssociations.commit(intent,{} as never)).rejects.toBeTruthy();
 const original=e.owner.runtimeAssociations;Reflect.set(e.owner,'runtimeAssociations',{...original,commit:async()=>{throw Error('write failed');}});
 try{await expect(e.runtime.retire(e.producer,operation())).rejects.toThrow('write failed');expect(e.docker.mutations()).toHaveLength(0);}
 finally{Reflect.set(e.owner,'runtimeAssociations',original);}
});
