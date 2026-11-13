import { initialize } from '../../src/journal/schema.js';
import { transaction } from '../../src/journal/sql.js';
import { commitAgentSettlement } from '../../src/journal/settlement-guard/index.js';
import { requestFor } from '../producer-retirement/fixtures.js';
import { expect,it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { fixture } from '../no-task-composition/fixtures.js';
import { cleanupAccess } from '../../src/cleanup-access/index.js';
import { cleanedReplyDigest } from '@beetle/contracts/output-settlement';
import { retirementDigest } from '../../src/retirement-values/index.js';
const f=fixture();
it('cleans a genuinely admitted abort before staging using C1 and real hold credit, without rejected funding or fake roles',async()=>{
 const e=await f.composed('admitted');const selected=await e.owner.retirements.select(e.request);expect(selected).toMatchObject({funding:'admitted',intent:{task:{state:'none'}}});
 const snapshot=await e.owner.get(e.key);expect(snapshot.admission).toEqual({state:'released',disposition:'never_started'});
 expect(await e.owner.stagingNamespace.readTask({...e.key,generation:1})).toBeNull();
 const work=e.pipeline.tickWithPorts(e.request,{deadline:performance.now()+10000},e.ports);const reply=await work.result;await work.settled;
 expect(reply.state).toBe('cleaned');expect(e.docker.calls).toHaveLength(8);expect(e.docker.calls.every(call=>call.method==='GET')).toBe(true);
 const fence=cleanupAccess(e.owner.retirements).reserve(e.request);const observation=await fence.drain();
 const request={version:1 as const,retirement:e.request,cleanupReplyDigest:cleanedReplyDigest(reply,e.request,retirementDigest)};
 const settled=await e.owner.settlements.settle(observation,request);fence.release();expect(settled.chargedBytes).toBe(4096);
 await f.close(e.owner);const reopened=await f.open(e.journalPath);expect(await reopened.settlements.retiredReply(e.request)).toEqual(reply);await f.close(reopened);
 const db=new DatabaseSync(e.journalPath,{readOnly:true});try{
  const body=JSON.parse(String(db.prepare('SELECT tombstone_json FROM retired_attempts').get()?.tombstone_json)) as {version:number;charges:{cleanupControlBytes:number;holdBytes:number};disk:{outputBytes:number;stagingBytes:number}};
  expect(body.version).toBe(1);expect(body.charges).toMatchObject({cleanupControlBytes:196608,holdBytes:512});
  expect(body.disk.outputBytes).toBeGreaterThan(0);expect(body.disk.stagingBytes).toBeGreaterThanOrEqual(65536);
  expect(db.prepare('SELECT original_count,charged_bytes,last_clock FROM rejected_cleanup_storage').get()).toMatchObject({original_count:0,charged_bytes:0,last_clock:0});
  expect(db.prepare('SELECT held_count,held_output_bytes,held_staging_bytes FROM disk_retention_stats').get()).toMatchObject({held_count:0,held_output_bytes:0,held_staging_bytes:0});
  expect(db.prepare('SELECT original_count,charged_bytes FROM agent_replay_storage').get()).toMatchObject({original_count:1,charged_bytes:4096});
  expect(db.prepare('SELECT count(*) n FROM output_no_task_cleanup_receipts').get()?.n).toBe(0);expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{db.close();}
});
it('leaves another original’s prepaid rejected control and clock untouched when releasing a C1 hold',async()=>{
 const e=await f.composed('admitted');const other=structuredClone(e.offer);other.attemptId='00000000-0000-4000-8000-000000000099';
 await e.owner.cancelOriginal({offer:other,now:Date.now()});const otherKey={...e.key,attemptId:other.attemptId};
 const proof=await e.owner.closeOutputAbsence(otherKey);if(!proof)throw Error('Missing peer closure');
 const otherRequest={...requestFor(proof),runId:'00000000-0000-4000-8000-000000000303',deletionId:'00000000-0000-4000-8000-000000000304'};
 await e.owner.retirements.fundRejected(otherRequest);
 const work=e.pipeline.tickWithPorts(e.request,{deadline:performance.now()+10000},e.ports);const reply=await work.result;await work.settled;
 await f.close(e.owner);const db=initialize(e.journalPath);try{
  const before=db.prepare('SELECT * FROM rejected_cleanup_storage').get();const control=db.prepare('SELECT * FROM rejected_cleanup_controls').all();
  transaction(db,()=>commitAgentSettlement(db,{version:1,retirement:e.request,cleanupReplyDigest:cleanedReplyDigest(reply,e.request,retirementDigest)}));
  expect(db.prepare('SELECT * FROM rejected_cleanup_storage').get()).toEqual(before);
  expect(db.prepare('SELECT * FROM rejected_cleanup_controls').all()).toEqual(control);
  expect(db.prepare('SELECT held_count FROM disk_retention_stats').get()?.held_count).toBe(0);
 }finally{db.close();}
});
