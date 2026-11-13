import { cleanupAccess } from '../../src/cleanup-access/index.js';
import { scope,validation } from '../admission/fixtures.js';
import { expect,it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { fixture } from './fixtures.js';
import { loseReply } from '../source-journal/fixtures.js';
const f=fixture();
it('converts the actual temporary control into one charged anti-replay floor without inventing a hold refund',async()=>{
 const e=await f.cleaned();await e.owner.settlements.preflight(e.request);const reply=await e.owner.settlements.settle(e.observation,e.request);e.fence.release();
 expect(reply.chargedBytes).toBe(4096);expect(await e.owner.settlements.retiredReply(e.retirement)).toEqual(e.reply);
 await f.close(e.owner);const owner=await f.open(e.journalPath);
 expect(await owner.settlements.retiredReply(e.retirement)).toEqual(e.reply);
 const nextFence=cleanupAccess(owner.retirements).reserve(e.retirement);
 const nextObservation=await nextFence.drain();expect(await owner.settlements.settle(nextObservation,e.request)).toEqual(reply);nextFence.release();
 await expect(owner.cancelOriginal({offer:e.offer,now:Date.now()})).rejects.toMatchObject({code:'conflict'});
 await expect(owner.immutableOffer(e.offer)).rejects.toMatchObject({code:'conflict'});await f.close(owner);
 const db=new DatabaseSync(e.journalPath,{readOnly:true});try{
  expect(db.prepare('SELECT original_count,charged_bytes FROM rejected_cleanup_storage').get()).toMatchObject({original_count:0,charged_bytes:0});
  expect(db.prepare('SELECT original_count,charged_bytes FROM agent_replay_storage').get()).toMatchObject({original_count:1,charged_bytes:4096});
  expect(db.prepare('SELECT held_count,held_output_bytes,held_staging_bytes FROM disk_retention_stats').get()).toMatchObject({held_count:0,held_output_bytes:0,held_staging_bytes:0});
  expect(db.prepare('SELECT count(*) n FROM accepted_attempts').get()?.n).toBe(0);
  expect(db.prepare('SELECT count(*) n FROM rejected_cleanup_receipts').get()?.n).toBe(0);
  expect(db.prepare('SELECT count(*) n FROM rejected_cleanup_controls').get()?.n).toBe(0);
  expect(db.prepare('SELECT json_extract(tombstone_json,\'$.version\') v FROM retired_attempts').get()?.v).toBe(2);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{db.close();}
});
it('reconciles actual committed settlement reply loss after worker reopen without a second credit',async()=>{
 const e=await f.cleaned();const expected=await loseReply(e.owner,()=>e.owner.settlements.settle(e.observation,e.request));e.fence.release();
 const owner=await f.open(e.journalPath);
 const fence=cleanupAccess(owner.retirements).reserve(e.retirement);const observation=await fence.drain();
 expect(await owner.settlements.settle(observation,e.request)).toEqual(expected);fence.release();
});

it('preserves an unrelated charged hold and its reservation while settling rejected metadata',async()=>{
 const e=await f.cleaned();const other=structuredClone(e.offer);other.attemptId='00000000-0000-4000-8000-abcdef000002';
 const at=Date.now();await e.owner.admission({kind:'offer',offer:other,validation:validation(other),now:at});
 const reservation=await e.owner.admission({kind:'admit',key:scope(other),sourceOrdinal:1,now:at});
 expect(reservation).toMatchObject({status:'charged'});
 const settled=await e.owner.settlements.settle(e.observation,e.request);e.fence.release();expect(settled.chargedBytes).toBe(4096);
 expect(await e.owner.admission({kind:'reservation',key:scope(other)})).toEqual(reservation);
 await f.close(e.owner);const db=new DatabaseSync(e.journalPath,{readOnly:true});try{
  expect(db.prepare('SELECT held_count FROM disk_retention_stats').get()?.held_count).toBe(1);
  expect(db.prepare('SELECT count(*) n FROM disk_holds WHERE attempt_id=?').get(other.attemptId)?.n).toBe(1);
  expect(db.prepare('SELECT count(*) n FROM accepted_attempts').get()?.n).toBe(1);
 }finally{db.close();}
});
it('refuses missing no-task proof and stale cleanup commitments before allocating replay credit',async()=>{
 const missing=await f.ready();const request={version:1 as const,retirement:missing.request,cleanupReplyDigest:'f'.repeat(64)};
 await expect(missing.owner.settlements.preflight(request)).rejects.toMatchObject({code:'conflict'});
 expect(await missing.owner.retirements.read(missing.key)).not.toBeNull();
 const e=await f.cleaned();await expect(e.owner.settlements.preflight({...e.request,cleanupReplyDigest:'f'.repeat(64)})).rejects.toMatchObject({code:'conflict'});
 await expect(e.owner.settlements.preflight({...e.request,retirement:{...e.retirement,deletionId:e.retirement.runId}})).rejects.toMatchObject({code:'conflict'});
 await e.owner.settlements.preflight(e.request);expect((await e.owner.settlements.settle(e.observation,e.request)).chargedBytes).toBe(4096);e.fence.release();
});
