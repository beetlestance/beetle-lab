import {expect,it} from 'vitest';
import type {AttemptSnapshot} from '@beetle/contracts';
import {DatabaseSync} from 'node:sqlite';
import {storageFixture,seed,scope} from '../storage/fixture.js';
import {createSuite,append,request} from '../storage/suites-fixture.js';
import {options,createCommand} from './fixture.js';
const f=storageFixture();
async function setup(){
 const path=f.path();const config=options();const metadata=await f.open(path,config);await seed(metadata);
 const body=request();body.config.secrets=[];const revision=await append(metadata,await createSuite(metadata),60,body);
 const job=await metadata.exports.create(createCommand(revision.id));const key={scope,id:job.id};
 const claim=await metadata.exportExecutions.claim(key);if(claim.kind==='blocked'||claim.control.binding===null)throw Error('claim');
 const binding=claim.control.binding;
 const admission={state:'rejected' as const,reason:'controls_unavailable' as const};
 const snapshot:AttemptSnapshot={protocolVersion:'1.0',...binding.key.attempt,state:'offered',phase:'validate',lastSeq:1,retainedStartSeq:1,cancelRequested:false,admission};
 const proof={version:1,...binding.key.attempt,journalAuthority:binding.journalAuthority,finalAgentSeq:1,admission,reason:'unsupported_capability'};
 return {path,config,metadata,key,binding,snapshot,proof};
}
it('requires matching authenticated final absence, keeps unknown charged, replays and reopens without source or script',async()=>{
 const e=await setup();
 await expect(e.metadata.exportOutputs.settleAbsence({binding:e.binding,proof:e.proof})).rejects.toMatchObject({code:'conflict'});
 await e.metadata.exportExecutions.observe({key:e.key,snapshot:e.snapshot,journalAuthority:e.binding.journalAuthority});
 await expect(e.metadata.exportOutputs.settleAbsence({binding:e.binding,proof:{...e.proof,finalAgentSeq:2}})).rejects.toMatchObject({code:'conflict'});
 await expect(e.metadata.exportOutputs.settleAbsence({binding:e.binding,proof:{...e.proof,journalAuthority:'00000000-0000-4000-8000-000000000099'}})).rejects.toBeDefined();
 const job=await e.metadata.exportOutputs.settleAbsence({binding:e.binding,proof:e.proof});
 expect(job).toMatchObject({state:'failed',reason:'unsupported_capability',artifact:null});
 expect(await e.metadata.exportOutputs.settleAbsence({binding:e.binding,proof:e.proof})).toEqual(job);
 await f.close(e.metadata);const db=new DatabaseSync(e.path);
 try{
  expect(db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBe(3145728);
  expect(db.prepare('SELECT execution_charged,output_charged FROM export_jobs').get()).toMatchObject({execution_charged:0,output_charged:0});
  expect(db.prepare('SELECT COUNT(*) n FROM export_sources').get()?.n).toBe(0);
  expect(db.prepare('SELECT COUNT(*) n FROM export_artifacts').get()?.n).toBe(0);
 }finally{db.close();}
 const reopened=await f.open(e.path,{...e.config,runtime:null});
 expect(await reopened.exportOutputs.settleAbsence({binding:e.binding,proof:e.proof})).toEqual(job);
});
