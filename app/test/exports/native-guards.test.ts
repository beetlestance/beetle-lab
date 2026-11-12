import {expect,it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {encodeCanonicalJson} from '@beetle/contracts';
import {storageFixture,seed,scope} from '../storage/fixture.js';
import {createSuite,append,request} from '../storage/suites-fixture.js';
import {options,createCommand} from './fixture.js';
import {sourceFixture} from './source-fixture.js';
const f=storageFixture();
it('refuses native source insertion and credit release against a running snapshot, preserving all charges',async()=>{
 const path=f.path();const metadata=await f.open(path,options());await seed(metadata);const body=request();body.config.secrets=[];
 const revision=await append(metadata,await createSuite(metadata),60,body);const job=await metadata.exports.create(createCommand(revision.id));const key={scope,id:job.id};
 const claim=await metadata.exportExecutions.claim(key);if(claim.kind==='blocked')throw Error('claim');
 const original=await metadata.exportExecutions.original(key);const source=sourceFixture(original,claim.control,Buffer.from('synthetic'));
 const {exportResult:unusedResult,...snapshot}=source.snapshot;void unusedResult;
 await metadata.exportExecutions.observe({key,journalAuthority:source.binding.journalAuthority,snapshot:{...snapshot,state:'running',phase:'execute',admission:{state:'charged'}}});
 await f.close(metadata);const db=new DatabaseSync(path);db.exec('PRAGMA foreign_keys=ON');
 try{
  const before=db.prepare('SELECT execution_charged,output_charged,version FROM export_jobs').get();
  const usage=db.prepare('SELECT charged_bytes FROM installation_storage_usage').get();const e=source.envelope;
  expect(()=>db.prepare('INSERT INTO export_sources(export_id,assignment_digest,manifest_digest,source_digest,source_json,final_agent_seq) VALUES(?,?,?,?,?,?)')
   .run(job.id,source.binding.expectation.assignmentDigest,e.manifest.manifestDigest,e.sourceDigest,encodeCanonicalJson(e,75776),e.closure.finalAgentSeq)).toThrow('export source mismatch');
  expect(()=>db.prepare("UPDATE export_jobs SET state='failed',reason='build_failed',execution_charged=0,output_charged=0,version=version+1 WHERE id=?").run(job.id)).toThrow();
  expect(db.prepare('SELECT execution_charged,output_charged,version FROM export_jobs').get()).toEqual(before);
  expect(db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()).toEqual(usage);
  expect(db.prepare('SELECT COUNT(*) n FROM export_sources').get()?.n).toBe(0);
 }finally{db.close();}
});
