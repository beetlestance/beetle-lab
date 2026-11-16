import { expect,it } from 'vitest';
import { fixture } from './fixtures.js';
import { deferred } from '../output-collection/fixture.js';
const f=fixture();const operation=()=>({deadline:performance.now()+10000});
function holdReceipt(e:Awaited<ReturnType<typeof f.completed>>){
 const receive=Reflect.get(e.owner,'receive') as (reply:unknown)=>void;const issued=deferred<unknown>();let held=false;
 Reflect.set(e.owner,'receive',(reply:unknown)=>{const value=reply&&typeof reply==='object'?Reflect.get(reply,'value'):undefined;const stored=value&&typeof value==='object'?Reflect.get(value,'stored'):undefined;
  if(!held&&stored&&typeof stored==='object'&&Reflect.has(stored,'receipt')){held=true;issued.resolve(reply);return;}receive.call(e.owner,reply);});
 return{issued,release:(reply:unknown)=>receive.call(e.owner,reply)};
}
it('coalesces finalization and retains a held actual commit through shutdown, without late success',async()=>{
 const e=await f.completed();const hold=holdReceipt(e);const count=e.effects.length;
 const pending=e.receipt.finalizeWithPorts(e.token,operation(),e.ports);void pending.catch(()=>undefined);const reply=await hold.issued.promise;
 expect(e.receipt.finalizeWithPorts(e.token,operation(),e.ports)).toBe(pending);expect(e.effects).toHaveLength(count);
 let closed=false;const closing=e.receipt.close().then(()=>{closed=true;});await Promise.resolve();expect(closed).toBe(false);
 hold.release(reply);await expect(pending).rejects.toMatchObject({reason:'closed'});await closing;expect(await e.owner.cleanupReceipts.read(e.plan)).not.toBeNull();
});
it('keeps the issued receipt request and slot until failed worker termination actually settles',async()=>{
 const e=await f.completed();const hold=holdReceipt(e);const actual=Reflect.get(e.owner,'terminate') as ()=>Promise<number>;
 const termination=deferred<void>();let original:Promise<number>|undefined;Reflect.set(e.owner,'terminate',()=>{original??=actual.call(e.owner);return original.then(async code=>{await termination.promise;return code;});});
 const pending=e.receipt.finalizeWithPorts(e.token,operation(),e.ports);void pending.catch(()=>undefined);await hold.issued.promise;
 const aborting=e.owner.abort();void aborting.catch(()=>undefined);await Promise.resolve();expect(e.receipt.status().retained).toBe(1);
 let closed=false;const closing=e.receipt.close().then(()=>{closed=true;});await Promise.resolve();expect(closed).toBe(false);
 termination.resolve();await aborting;await expect(pending).rejects.toMatchObject({code:'unavailable'});await closing;expect(e.receipt.status().retained).toBe(0);
 const journal=await f.open(e.journalPath);expect(await journal.cleanupReceipts.read(e.plan)).not.toBeNull();await journal.close();
});
