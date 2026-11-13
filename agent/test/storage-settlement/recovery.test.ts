import { expect,it } from 'vitest';
import { fixture } from './fixtures.js';
import { cleanupAccess } from '../../src/cleanup-access/index.js';
import { deferred } from '../output-collection/fixture.js';
import { DatabaseSync } from 'node:sqlite';
import { purgeOrder } from '../../src/journal/settlements/purge-order.js';
const f=fixture();
it('holds the settlement carrier/fence through a lost committed reply and replays after actual worker reopen',async()=>{
 const e=await f.cleaned();const receive=Reflect.get(e.owner,'receive') as (reply:unknown)=>void;const issued=deferred<void>();let held=false;
 Reflect.set(e.owner,'receive',(reply:unknown)=>{
  const value=reply&&typeof reply==='object'?Reflect.get(reply,'value'):undefined;
  if(!held&&value&&typeof value==='object'&&Reflect.get(value,'state')==='settled'){held=true;issued.resolve();return;}
  receive.call(e.owner,reply);
 });
 const pending=e.owner.settlements.settle(e.observation,e.request);void pending.catch(()=>{});
 try{
  await issued.promise;expect(()=>e.fence.release()).toThrow('custody');
  expect(await e.owner.settlements.retiredReply(e.request.retirement)).toEqual(e.cleaned);
  await e.owner.abort();await expect(pending).rejects.toMatchObject({code:'unavailable'});
 }finally{await e.owner.abort();await pending.catch(()=>{});e.fence.release();}
 const db=new DatabaseSync(e.journalPath,{readOnly:true});
 try{
  for(const table of purgeOrder)expect(db.prepare(`SELECT count(*) n FROM ${table} WHERE attempt_id=?`).get(e.offer.attemptId)?.n,table).toBe(0);
  expect(db.prepare('SELECT * FROM agent_replay_storage').get()).toEqual({id:1,original_count:1,charged_bytes:4096});
  expect(db.prepare('SELECT count(*) n FROM retired_attempts').get()?.n).toBe(1);
 }finally{db.close();}
 const owner=await f.open(e.journalPath);const fence=cleanupAccess(owner.retirements).reserve(e.request.retirement);
 try{
  const observation=await fence.drain();const reply=await owner.settlements.settle(observation,e.request);
  expect(reply).toMatchObject({state:'settled',chargedBytes:4096});expect(await owner.settlements.retiredReply(e.request.retirement)).toEqual(e.cleaned);
  await expect(owner.immutableOffer(e.offer)).rejects.toMatchObject({code:'conflict'});
 }finally{fence.release();}
});
