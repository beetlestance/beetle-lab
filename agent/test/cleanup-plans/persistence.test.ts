import { expect,it } from 'vitest';
import { fixture } from './fixtures.js';
import { deferred } from '../output-collection/fixture.js';
const f=fixture();
it('retains the actual issued plan carrier through close and publishes no late success after shutdown',async()=>{
 const e=await f.prepared();const receive=Reflect.get(e.owner,'receive') as (reply:unknown)=>void;const id=Number(Reflect.get(e.owner,'nextId'))+1;
 const issued=deferred<unknown>();Reflect.set(e.owner,'receive',(reply:unknown)=>{
  if(reply&&typeof reply==='object'&&Reflect.get(reply,'id')===id&&Reflect.get(reply,'ok')===true){issued.resolve(reply);return;}
  receive.call(e.owner,reply);
 });
 const pending=e.inventory.persist(e.observed,{deadline:performance.now()+10000});void pending.catch(()=>undefined);
 const reply=await issued.promise;expect(e.inventory.status().pendingPlans).toBe(1);let closed=false;
 const closing=e.inventory.close().then(()=>{closed=true;});await Promise.resolve();expect(closed).toBe(false);
 receive.call(e.owner,reply);await expect(pending).rejects.toMatchObject({reason:'closed'});await closing;
 expect(e.inventory.status().pendingPlans).toBe(0);expect(await e.owner.cleanupPlans.read(e.key)).not.toBeNull();
});
it('captures one fixed deadline before issuing the plan and does not compensate a committed late reply',async()=>{
 const e=await f.prepared();const receive=Reflect.get(e.owner,'receive') as (reply:unknown)=>void;const id=Number(Reflect.get(e.owner,'nextId'))+1;
 const issued=deferred<unknown>();Reflect.set(e.owner,'receive',(reply:unknown)=>{
  if(reply&&typeof reply==='object'&&Reflect.get(reply,'id')===id&&Reflect.get(reply,'ok')===true){issued.resolve(reply);return;}receive.call(e.owner,reply);
 });
 const controller=new AbortController();const pending=e.inventory.persist(e.observed,{deadline:performance.now()+10000,signal:controller.signal});void pending.catch(()=>undefined);
 const reply=await issued.promise;controller.abort();expect(e.inventory.status().pendingPlans).toBe(1);receive.call(e.owner,reply);
 await expect(pending).rejects.toMatchObject({reason:'closed'});expect(await e.owner.cleanupPlans.read(e.key)).not.toBeNull();
});
it('keeps a failed actual carrier retained until worker termination settles, without retrying native inventory',async()=>{
 const e=await f.prepared();const receive=Reflect.get(e.owner,'receive') as (reply:unknown)=>void;const id=Number(Reflect.get(e.owner,'nextId'))+1;
 const issued=deferred<void>();Reflect.set(e.owner,'receive',(reply:unknown)=>{
  if(reply&&typeof reply==='object'&&Reflect.get(reply,'id')===id&&Reflect.get(reply,'ok')===true){issued.resolve();return;}receive.call(e.owner,reply);
 });
 const actualTerminate=Reflect.get(e.owner,'terminate') as ()=>Promise<number>;const termination=deferred<void>();let original:Promise<number>|undefined;
 Reflect.set(e.owner,'terminate',()=>{original??=actualTerminate.call(e.owner);return original.then(async code=>{await termination.promise;return code;});});
 const pending=e.inventory.persist(e.observed,{deadline:performance.now()+10000});void pending.catch(()=>undefined);await issued.promise;
 const aborting=e.owner.abort();void aborting.catch(()=>undefined);await Promise.resolve();await Promise.resolve();
 expect(e.inventory.status().pendingPlans).toBe(1);let closed=false;const closing=e.inventory.close().then(()=>{closed=true;});await Promise.resolve();expect(closed).toBe(false);
 termination.resolve();await aborting;await expect(pending).rejects.toMatchObject({code:'unavailable'});await closing;expect(e.inventory.status().pendingPlans).toBe(0);
 const journal=await f.open(e.journalPath);expect(await journal.cleanupPlans.read(e.key)).not.toBeNull();await journal.close();
});
