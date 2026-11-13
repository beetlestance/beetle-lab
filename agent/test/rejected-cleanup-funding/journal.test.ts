import { expect,it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { observation } from '../admission/fixtures.js';
import { loseReply } from '../source-journal/fixtures.js';
import { fundingFixture } from './fixtures.js';
const f=fundingFixture();
it.each(['cancel','rejected'] as const)('funds the actual %s closure once without inventing C1 or a disk hold',async kind=>{
 const v=await f.ready(kind);const expected=await v.journal.retirements.preflightRejected(v.request);
 expect(expected.task).toEqual({state:'none'});expect(await v.journal.retirements.read(v.key)).toBeNull();
 await expect(v.journal.retirements.fundRejected(v.request)).rejects.toMatchObject({code:'recovery_required'});
 expect(await v.journal.retirements.read(v.key)).toBeNull();
 await v.journal.admission({kind:'observe',observation:observation(Date.now())});
 expect(await v.journal.retirements.fundRejected(v.request)).toEqual(expected);
 await f.close(v.journal);const reopened=await f.open(v.path);
 // Startup deliberately invalidates samples; an exact already-funded original remains recoverable.
 expect(await reopened.retirements.fundRejected(v.request)).toEqual(expected);
 expect(await reopened.retirements.isOpen(v.key)).toBe(false);
 await expect(reopened.retirements.fundRejected({...v.request,deletionId:v.request.runId})).rejects.toMatchObject({code:'conflict'});
 await f.close(reopened);const db=new DatabaseSync(v.path,{readOnly:true});
 try{
  expect(db.prepare('SELECT original_count,charged_bytes FROM rejected_cleanup_storage').get()).toMatchObject({original_count:1,charged_bytes:16384});
  expect(db.prepare('SELECT cleanup_control_bytes,cleanup_control_version,hold_bytes FROM accepted_attempts').get())
   .toMatchObject({cleanup_control_bytes:0,cleanup_control_version:0,hold_bytes:0});
  expect(db.prepare('SELECT count(*) n FROM disk_holds').get()?.n).toBe(0);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{db.close();}
});
it('reconciles an actual funded worker commit after withheld reply and joined worker termination',async()=>{
 const v=await f.ready();await v.journal.admission({kind:'observe',observation:observation(Date.now())});
 const expected=await loseReply(v.journal,()=>v.journal.retirements.fundRejected(v.request));
 await v.journal.retirements.settleCarrier();const next=await f.open(v.path);
 expect(await next.retirements.fundRejected(v.request)).toEqual(expected);
});
it('leaves a low-quota original protected without a partially funded intent',async()=>{
 const v=await f.ready('cancel',1024);await v.journal.admission({kind:'observe',observation:observation(Date.now())});
 await expect(v.journal.retirements.fundRejected(v.request)).rejects.toMatchObject({code:'quota_exceeded'});
 expect(await v.journal.retirements.read(v.key)).toBeNull();expect(await v.journal.retirements.isOpen(v.key)).toBe(true);
});
