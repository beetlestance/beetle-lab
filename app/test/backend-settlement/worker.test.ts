import { expect,it } from 'vitest';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { fixture } from './fixture.js';
import { storageFixture,settingsFixture,observation } from '../storage/fixture.js';
import type { BackendSettlementResult } from '../../src/ports/output-settlement-metadata.js';
const storage=storageFixture();const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
it('recovers a lost committed credit through a fresh compiled worker without refunding twice',async()=>{
 const f=fixture();const before=f.usage();const path=storage.path();f.db.prepare('VACUUM INTO ?').run(path);
 const worker=new Worker(storage.workerUrl(),{workerData:{path,bootstrap:{installation:settingsFixture().chain.installation,runtime:observation(),runs:f.config}}});
 let original:BackendSettlementResult|undefined;
 try{
  await new Promise<void>((resolve,reject)=>{worker.once('error',reject);worker.on('message',(message:{kind:string;ok?:boolean;value?:BackendSettlementResult})=>{
   if(message.kind==='ready')worker.postMessage({...f.operation,messageId:1});
   else if(message.kind==='result'&&message.ok){original=message.value;resolve();}else reject(Error('Settlement did not commit'));
  });});
 }finally{await worker.terminate();}
 for(let n=0;n<2;n++){
  const metadata=await storage.open(path,{runtime:null,runs:f.config});
  expect(await metadata.outputSettlements.settle(f.request)).toEqual(original);
  expect(await metadata.outputSettlements.read(f.key)).toEqual({kind:'settled',settlement:original});
  expect((await metadata.inputs.storage()).chargedBytes).toBe(before-original!.refundedBytes);await storage.close(metadata);
 }
 const db=new DatabaseSync(path,{readOnly:true});try{
  expect(db.prepare('SELECT * FROM backend_replay_storage').get()).toEqual({id:1,original_count:1,charged_bytes:2560});
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{db.close();}
});
it.each(['held','rejected'] as const)('retains the public call while failed worker termination is %s',async kind=>{
 const f=fixture();const path=storage.path();f.db.prepare('VACUUM INTO ?').run(path);const metadata=await storage.open(path,{runtime:null,runs:f.config});
 const worker=Reflect.get(metadata,'worker') as Worker;const terminate=worker.terminate.bind(worker);
 let committed!:()=>void;const issued=new Promise<void>(resolve=>{committed=resolve;});
 let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
 const receive=Reflect.get(metadata,'receive') as (message:unknown)=>void;
 Reflect.set(metadata,'receive',(message:unknown)=>{
  if(message&&typeof message==='object'){
   const value=Reflect.get(message,'value');if(value&&typeof value==='object'&&Reflect.get(value,'refundedBytes')!==undefined){committed();return;}
  }
  receive.call(metadata,message);
 });
 worker.terminate=()=>kind==='held'?held.then(terminate):Promise.reject(Error('synthetic termination uncertainty'));
 const pending=metadata.outputSettlements.settle(f.request);let done=false;void pending.then(()=>{done=true;},()=>{done=true;});
 try{
  await issued;const aborting=metadata.abort();void aborting.catch(()=>{});await turn();expect(done).toBe(false);
  if(kind==='held'){
   release();await aborting;await expect(pending).rejects.toMatchObject({code:'unavailable'});
  }else{
   await expect(aborting).rejects.toThrow('synthetic termination uncertainty');await turn();expect(done).toBe(false);
  }
 }finally{
  release();await terminate();storage.handles.delete(metadata);
  // Actual fixture worker is reaped; cached failed carrier/call remains sticky, never healed.
 }
});
it('captures dispatched arguments and retires malformed or substituted worker replies',async()=>{
 const f=fixture();const path=storage.path();f.db.prepare('VACUUM INTO ?').run(path);const metadata=await storage.open(path,{runtime:null,runs:f.config});
 const request=structuredClone(f.request);const pending=metadata.outputSettlements.settle(request);
 request.agentReply.tombstoneDigest='f'.repeat(64);expect(await pending).toMatchObject({chargedBytes:2560});
 const receive=Reflect.get(metadata,'receive') as (message:unknown)=>void;let changed=false;
 Reflect.set(metadata,'receive',(message:unknown)=>{
  if(message&&typeof message==='object'&&Reflect.get(message,'kind')==='result'&&Reflect.get(message,'ok')===true){
   changed=true;Reflect.set(message,'value',{kind:'settled',settlement:{version:1,key:f.key,attemptId:f.key.runId,kind:'source',refundedBytes:-1,chargedBytes:2560,tombstoneDigest:'a'.repeat(64)}});
  }
  receive.call(metadata,message);
 });
 await expect(metadata.outputSettlements.read(f.key)).rejects.toMatchObject({code:'unavailable'});expect(changed).toBe(true);
});
