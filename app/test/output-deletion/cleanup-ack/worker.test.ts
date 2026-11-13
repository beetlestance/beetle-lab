import { expect,it } from 'vitest';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import type { OutputCleanupAck } from '../../../src/ports/output-deletion-metadata.js';
import { storageFixture,settingsFixture,observation } from '../../storage/fixture.js';
import { fixture,cleaned } from './fixture.js';
const storage=storageFixture();
it('recovers a lost committed ACK reply through actual worker termination/reopen without any refund',async()=>{
 const f=fixture();const request={key:f.key,reply:cleaned(f.request())};const before=f.usage();const path=storage.path();f.db.prepare('VACUUM INTO ?').run(path);
 const worker=new Worker(storage.workerUrl(),{workerData:{path,bootstrap:{installation:settingsFixture().chain.installation,runtime:observation(),runs:f.config}}});
 try{
  await new Promise<void>((resolve,reject)=>{worker.once('error',reject);worker.on('message',(message:{kind:string;ok?:boolean})=>{
   if(message.kind==='ready')worker.postMessage({kind:'recordOutputCleanupAck',request,messageId:1});
   else if(message.kind==='result'&&message.ok)resolve();else reject(Error('Compiled worker did not commit ACK'));
  });});
 }finally{await worker.terminate();}
 let metadata=await storage.open(path,{runtime:null,runs:f.config});const ack=await metadata.outputDeletions.recordCleanupAck(request);
 expect(ack.reply).toEqual(request.reply);expect(await metadata.outputDeletions.cleanupAck(f.key)).toEqual({kind:'stored',ack});
 expect((await metadata.inputs.storage()).chargedBytes).toBe(before);await storage.close(metadata);metadata=await storage.open(path,{runtime:null,runs:f.config});
 expect(await metadata.outputDeletions.recordCleanupAck(request)).toEqual(ack);expect((await metadata.inputs.storage()).chargedBytes).toBe(before);await storage.close(metadata);
 const db=new DatabaseSync(path);try{expect(db.prepare('SELECT count(*) n FROM backend_output_cleanup_acks').get()?.n).toBe(1);expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);}finally{db.close();}
});
it('captures exact ACK replies at both worker boundaries and refuses caller mutation after dispatch',async()=>{
 const f=fixture();const path=storage.path();f.db.prepare('VACUUM INTO ?').run(path);const metadata=await storage.open(path,{runtime:null,runs:f.config});
 const reply={...cleaned(f.request())};const expected={...reply};const pending=metadata.outputDeletions.recordCleanupAck({key:f.key,reply});
 if(reply.state==='cleaned')reply.cleanupReceiptDigest='f'.repeat(64);const ack=await pending;expect(ack.reply).toEqual(expected);
 const malformed={...ack,logicalBytes:0};const receive=Reflect.get(metadata,'receive') as (input:unknown)=>void;
 const rawCall=Reflect.get(metadata,'call') as (operation:unknown)=>Promise<OutputCleanupAck>;
 let changed=false;Reflect.set(metadata,'receive',(message:unknown)=>{
  if(message&&typeof message==='object'&&Reflect.get(message,'kind')==='result'&&Reflect.get(message,'ok')===true){changed=true;Reflect.set(message,'value',{kind:'stored',ack:malformed});}
  receive.call(metadata,message);
 });
 await expect(rawCall.call(metadata,{kind:'getOutputCleanupAck',key:f.key})).rejects.toThrow();expect(changed).toBe(true);
});
