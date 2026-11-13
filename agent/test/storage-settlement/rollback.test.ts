import { expect,it,vi } from 'vitest';
import { fixture,offline,snapshot } from './fixtures.js';
import { transaction } from '../../src/journal/sql.js';
import { commitAgentSettlement } from '../../src/journal/settlement-guard/index.js';
const f=fixture();
it('rolls the persisted tombstone, first deletion and all counters back on a late failure and clears the permit',async()=>{
 const e=await f.cleaned();const db=await offline(e);
 try{
  const before=snapshot(db);
  db.exec("CREATE TRIGGER task_fail_settlement AFTER DELETE ON output_absence_closures BEGIN SELECT RAISE(ABORT,'synthetic late purge failure'); END");
  expect(()=>transaction(db,()=>commitAgentSettlement(db,e.request))).toThrow('synthetic late purge failure');expect(snapshot(db)).toEqual(before);
  expect(()=>db.prepare('DELETE FROM output_absence_closures WHERE attempt_id=?').run(e.offer.attemptId)).toThrow();
  db.exec('DROP TRIGGER task_fail_settlement');
  const reply=transaction(db,()=>commitAgentSettlement(db,e.request));expect(reply).toMatchObject({state:'settled',chargedBytes:4096});
  expect(db.prepare('SELECT * FROM agent_replay_storage').get()).toEqual({id:1,original_count:1,charged_bytes:4096});
  expect(db.prepare('SELECT * FROM disk_retention_stats').get()).toEqual({id:1,held_count:0,held_output_bytes:0,held_staging_bytes:0,retained_output_bytes:0,retained_staging_bytes:0});
  expect(()=>db.exec('DELETE FROM retired_attempts')).toThrow();expect(()=>db.exec('UPDATE retired_attempts SET charged_bytes=4096')).toThrow();
  expect(()=>db.exec('INSERT OR REPLACE INTO retired_attempts SELECT * FROM retired_attempts')).toThrow();
  expect(()=>db.exec('UPDATE agent_replay_storage SET original_count=2,charged_bytes=8192')).toThrow();
 }finally{db.close();e.fence.release();}
});
it('refuses nested cross-original mutation and leaves unrelated data unchanged',async()=>{
 const e=await f.cleaned();const other={...e.offer,attemptId:'00000000-0000-4000-8000-000000000999'};
 await e.owner.immutableOffer(other);const db=await offline(e);
 try{
  const before=snapshot(db);
  db.exec(`CREATE TRIGGER task_cross_original AFTER DELETE ON output_absence_closures BEGIN
   UPDATE accepted_attempts SET cancel_requested=1 WHERE attempt_id='${other.attemptId}';END`);
  expect(()=>transaction(db,()=>commitAgentSettlement(db,e.request))).toThrow('settlement isolation');
  expect(snapshot(db)).toEqual(before);expect(db.prepare('SELECT cancel_requested FROM accepted_attempts WHERE attempt_id=?').get(other.attemptId)?.cancel_requested).toBe(0);
 }finally{db.close();e.fence.release();}
});
it('preserves an unexpected foreign reference rather than reporting successful compaction',async()=>{
 const e=await f.cleaned();const db=await offline(e);
 try{
  db.exec('CREATE TABLE task_unexpected_ref(attempt_id TEXT REFERENCES accepted_attempts(attempt_id))');
  db.prepare('INSERT INTO task_unexpected_ref VALUES(?)').run(e.offer.attemptId);const before=snapshot(db);
  expect(()=>transaction(db,()=>commitAgentSettlement(db,e.request))).toThrow(/FOREIGN KEY/i);expect(snapshot(db)).toEqual(before);
  expect(db.prepare('SELECT attempt_id FROM task_unexpected_ref').get()?.attempt_id).toBe(e.offer.attemptId);
 }finally{db.close();e.fence.release();}
});

it('refuses an overbound physical spool sentinel before aggregation or any purge',async()=>{
 const e=await f.cleaned();const db=await offline(e);const prepare=db.prepare.bind(db);let aggregated=false;
 const spy=vi.spyOn(db,'prepare').mockImplementation(sql=>{
  if(sql.includes('sum(charged_bytes)'))aggregated=true;
  if(sql.startsWith('SELECT count(*) n FROM')&&sql.includes('FROM event_spool '))return{get:()=>({n:65537})} as unknown as ReturnType<typeof prepare>;
  return prepare(sql);
 });
 try{
  expect(()=>transaction(db,()=>commitAgentSettlement(db,e.request))).toThrow('conflict');expect(aggregated).toBe(false);
  spy.mockRestore();expect(db.prepare('SELECT count(*) n FROM retired_attempts').get()?.n).toBe(0);
  expect(db.prepare('SELECT count(*) n FROM accepted_attempts WHERE attempt_id=?').get(e.offer.attemptId)?.n).toBe(1);
 }finally{spy.mockRestore();db.close();e.fence.release();}
});
