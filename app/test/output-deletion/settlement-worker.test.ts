import { expect,it } from 'vitest';
import { fixture } from '../backend-settlement/fixture.js';
import { storageFixture } from '../storage/fixture.js';
const storage=storageFixture();
it('discovers through the real compiled metadata boundary and stops returning a durably settled original',async()=>{
 const f=fixture(0);const path=storage.path();const before=f.usage();f.db.prepare('VACUUM INTO ?').run(path);
 const metadata=await storage.open(path,{runtime:null,runs:f.config});
 const page=await metadata.outputDeletions.scanSettlements({limit:32});expect(page.items.map(row=>row.id)).toEqual([f.key.id]);expect(page.nextCursor).toBeNull();
 expect((await metadata.inputs.storage()).chargedBytes).toBe(before);
 const settled=await metadata.outputSettlements.settle(f.request);expect(settled.chargedBytes).toBe(2560);
 expect(await metadata.outputDeletions.scanSettlements({limit:32})).toEqual({items:[],nextCursor:null});
 expect((await metadata.inputs.storage()).chargedBytes).toBe(before-settled.refundedBytes);await storage.close(metadata);
});
it('keeps scoped history retirement/defer outcomes distinct through the actual worker',async()=>{
 const f=fixture(0);const path=storage.path();f.db.prepare('VACUUM INTO ?').run(path);const metadata=await storage.open(path,{runtime:null,runs:f.config});
 const [job]=await metadata.historySummaries.scan({nowMs:Date.now(),limit:1});if(!job)throw Error('Missing job');
 expect(await metadata.historySummaries.retirement(job)).toEqual({state:'deleting',id:job.id,scope:job.scope,attemptId:job.attemptId});
 await metadata.outputSettlements.settle(f.request);const retired={state:'retired',id:job.id,scope:job.scope,attemptId:job.attemptId};
 expect(await metadata.historySummaries.retirement(job)).toEqual(retired);
 expect(await metadata.historySummaries.defer({job,dueMs:Date.now()+1000})).toEqual(retired);await storage.close(metadata);
});
it('refuses a substituted history retirement identity at the client boundary',async()=>{
 const f=fixture(0);const path=storage.path();f.db.prepare('VACUUM INTO ?').run(path);const metadata=await storage.open(path,{runtime:null,runs:f.config});
 const [job]=await metadata.historySummaries.scan({nowMs:Date.now(),limit:1});if(!job)throw Error('Missing job');
 const receive=Reflect.get(metadata,'receive') as (message:unknown)=>void;
 Reflect.set(metadata,'receive',(message:unknown)=>{
  if(message&&typeof message==='object'&&Reflect.get(message,'kind')==='result'&&Reflect.get(message,'ok')===true)
   Reflect.set(message,'value',{state:'retired',id:job.id,scope:job.scope,attemptId:job.id});
  receive.call(metadata,message);
 });
 await expect(metadata.historySummaries.retirement(job)).rejects.toMatchObject({code:'unavailable'});
});
