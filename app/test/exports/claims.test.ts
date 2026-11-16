import {expect,it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {withRawGuards} from '../storage/raw-connection-fixture.js';
import {storageFixture,seed,scope,uuid} from '../storage/fixture.js';
import {createSuite,append,request} from '../storage/suites-fixture.js';
import {runCommand} from '../storage/runs-fixture.js';
import {options,createCommand} from './fixture.js';
const f=storageFixture();
async function setup(){
 const path=f.path();const config=options();const metadata=await f.open(path,config);await seed(metadata);
 const body=request();body.config.secrets=[];const revision=await append(metadata,await createSuite(metadata),60,body);
 return {metadata,path,revision,config};
}
it('binds authority and storage before possible delivery; replays the exact original after worker reopen',async()=>{
 const e=await setup();let metadata=e.metadata;const job=await metadata.exports.create(createCommand(e.revision.id));const key={scope,id:job.id};
 const claim=await metadata.exportExecutions.claim(key);expect(claim.kind).toBe('claimed');if(claim.kind==='blocked')throw Error('claim');
 expect(claim.control).toMatchObject({possibleDelivery:true,acknowledged:false,binding:{purpose:'standalone_export',key:{exportId:job.id}}});
 const original=await metadata.exportExecutions.original(key);expect(original.assignment.exportId).toBe(job.id);
 expect(original.journalAuthority).toBe(claim.control.binding!.journalAuthority);
 await f.close(metadata);const db=new DatabaseSync(e.path);try{
  expect(db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBe(3145728+100000);
  expect(db.prepare('SELECT possible_delivery,execution_charged,output_charged FROM export_jobs').get()).toMatchObject({possible_delivery:1,execution_charged:1,output_charged:100000});
 }finally{db.close();}
 metadata=await f.open(e.path,{...e.config,runtime:null});
 expect(await metadata.exportExecutions.claim(key)).toEqual({...claim,kind:'replay'});
 expect(await metadata.exportExecutions.original(key)).toEqual(original);
 const snapshot={protocolVersion:'1.0' as const,...claim.control.binding!.key.attempt,state:'preparing' as const,phase:'prepare' as const,
  lastSeq:1,retainedStartSeq:1,cancelRequested:false,admission:{state:'charged' as const}};
 expect(await metadata.exportExecutions.observe({key,snapshot,journalAuthority:original.journalAuthority!})).toMatchObject({state:'generating'});
 expect(await metadata.exportExecutions.control(key)).toMatchObject({acknowledged:true});
 await expect(metadata.exportExecutions.observe({key,snapshot:{...snapshot,workspaceId:uuid(9)},journalAuthority:original.journalAuthority!})).rejects.toMatchObject({code:'invalid_value'});
});
it('enforces isolated ordering across both job kinds and shares charged concurrency',async()=>{
 const e=await setup();const input=createCommand(e.revision.id);const isolated={...input.request,executionPolicy:{mode:'isolated' as const,preferIdle:false}};
 const job=await e.metadata.exports.create(createCommand(e.revision.id,500,isolated));
 const run=await e.metadata.runs.execute(runCommand(e.revision.id));
 const queued=await e.metadata.dispatch.scan({lane:'queued',limit:32});const candidate=queued.items.find(item=>item.key.runId===run.id)!;
 expect(candidate.eligibility).toMatchObject({kind:'blocked',reason:'isolated_predecessor'});
 expect((await e.metadata.exportExecutions.claim({scope,id:job.id})).kind).toBe('claimed');
 expect(await e.metadata.dispatch.claim(candidate.key)).toMatchObject({kind:'blocked',reason:'isolated'});
 const next=await e.metadata.exports.create(createCommand(e.revision.id,501));
 expect(await e.metadata.exportExecutions.claim({scope,id:next.id})).toEqual({kind:'blocked'});
});
it('keeps polling compact even when the immutable assignment is unavailable, and refuses malformed original reads',async()=>{
 const e=await setup();const job=await e.metadata.exports.create(createCommand(e.revision.id));const key={scope,id:job.id};
 expect((await e.metadata.exportExecutions.claim(key)).kind).toBe('claimed');await f.close(e.metadata);
 // A closed, deliberately corrupt private fixture; live ownership guards remain enabled in the test above.
 const db=withRawGuards(new DatabaseSync(e.path));try{
  db.exec('DROP TRIGGER export_original_immutable');db.prepare("UPDATE export_originals SET assignment_json='{}' WHERE export_id=?").run(job.id);
 }finally{db.close();}
 const metadata=await f.open(e.path,e.config);
 expect(await metadata.exportExecutions.control(key)).toMatchObject({possibleDelivery:true,binding:{key:{exportId:job.id}}});
 await expect(metadata.exportExecutions.original(key)).rejects.toMatchObject({code:'unavailable'});
});
