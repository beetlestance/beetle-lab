import { it,expect } from 'vitest';
import type { Worker } from 'node:worker_threads';
import { selected } from './apply-fixture.js';
import { storageFixture } from '../storage/fixture.js';
import { scope,uuid } from './fixture.js';
const storage=storageFixture();
it('recovers lost committed Apply through fresh compiled workers and observes exact settlement/completion',async()=>{
 const f=selected();const path=storage.path();f.db.prepare('VACUUM INTO ?').run(path);const originalUsage=f.db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes;const installation=f.settings.chain(scope).installation;f.db.close();
 const metadata=await storage.open(path,{runtime:null,runs:f.config,installation});
 let committed!:()=>void;const issued=new Promise<void>(resolve=>{committed=resolve;});const receive=Reflect.get(metadata,'receive') as (value:unknown)=>void;
 Reflect.set(metadata,'receive',(message:unknown)=>{
  if(message&&typeof message==='object'){const value=Reflect.get(message,'value');if(value&&typeof value==='object'&&Reflect.get(value,'state')==='admitted'){committed();return;}}
  receive.call(metadata,message);
 });
 const pending=metadata.retention.apply(f.input);const outcome=pending.then(value=>({ok:true as const,value}),()=>({ok:false as const}));await issued;await metadata.abort();expect((await outcome).ok).toBe(false);
 const reopened=await storage.open(path,{runtime:null,runs:f.config,installation});const receipt=await reopened.retention.apply({...f.input,id:uuid(60000)});
 expect(receipt).toMatchObject({state:'admitted',maximumCandidates:3,snapshotId:f.page.id});expect((await reopened.inputs.storage()).chargedBytes).toBe(originalUsage);
 const key={scope,id:f.page.id};expect((await reopened.retention.get(key,Date.parse('2026-11-14T12:02:00.000Z'))).completedCount).toBe(0);
 for(const member of f.page.candidates)await reopened.outputSettlements.settle({key:{scope,id:member.deletionId,runId:member.id},agentReply:null});
 const completed=await reopened.retention.get(key,Date.parse('2026-11-14T12:03:00.000Z'));expect(completed.state).toBe('completed');expect(completed.completedCount).toBe(3);await storage.close(reopened);
 const fresh=await storage.open(path,{runtime:null,runs:f.config,installation});expect((await fresh.retention.get(key,Date.parse('2026-11-14T12:04:00.000Z'))).completedAt).toBe(completed.completedAt);
 expect((await fresh.retention.discard(key,Date.parse('2026-11-14T12:04:00.000Z'))).refundedLogicalBytes).toBe(131072);expect((await fresh.inputs.storage()).chargedBytes).toBe(3*2560+512);await storage.close(fresh);
});
it('keeps a rejected forged worker response owned until actual termination joins',async()=>{
 const f=selected();const path=storage.path();f.db.prepare('VACUUM INTO ?').run(path);const installation=f.settings.chain(scope).installation;f.db.close();
 const metadata=await storage.open(path,{runtime:null,runs:f.config,installation});const worker=Reflect.get(metadata,'worker') as Worker;const terminate=worker.terminate.bind(worker);
 let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let observed!:()=>void;const received=new Promise<void>(resolve=>{observed=resolve;});
 worker.terminate=()=>held.then(terminate);const receive=Reflect.get(metadata,'receive') as (value:unknown)=>void;
 Reflect.set(metadata,'receive',(message:unknown)=>{
  if(message&&typeof message==='object'){const value=Reflect.get(message,'value');if(value&&typeof value==='object'&&Reflect.get(value,'items')){
   const forged={...(value as object),id:uuid(60001)};receive.call(metadata,{...(message as object),value:forged});observed();return;
  }}receive.call(metadata,message);
 });
 const pending=metadata.retention.get({scope,id:f.page.id},Date.parse('2026-11-14T12:01:00.000Z'));let done=false;
 const result=pending.then(()=>{done=true;return true;},()=>{done=true;return false;});
 try{await received;await new Promise<void>(resolve=>setImmediate(resolve));expect(done).toBe(false);release();expect(await result).toBe(false);}
 finally{release();worker.terminate=terminate;await metadata.abort();}
});
