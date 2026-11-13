import { expect,it } from 'vitest';
import { fixture } from './fixtures.js';
import { deferred } from '../output-collection/fixture.js';
const f=fixture();const operation=()=>({deadline:performance.now()+10000});
it('coalesces exact requests and retains late native originals through abort/close before settling',async()=>{
 const e=await f.pipeline();const issued=deferred<void>();const release=deferred<void>();const controller=new AbortController();
 const ports={...e.ports,inventory:{...e.ports.inventory,open:async(...args:Parameters<typeof e.ports.inventory.open>)=>{issued.resolve();await release.promise;return e.ports.inventory.open(...args);}}};
 const work=e.pipeline.tickWithPorts(e.request,{...operation(),signal:controller.signal},ports);void work.result.catch(()=>undefined);await issued.promise;
 expect(e.pipeline.tickWithPorts(e.request,operation(),ports)).toBe(work);controller.abort();let closed=false;
 const closing=e.pipeline.close().then(()=>{closed=true;});await Promise.resolve();expect(closed).toBe(false);expect(e.pipeline.status().retained).toBe(1);
 release.resolve();await expect(work.result).rejects.toBeTruthy();await expect(work.settled).rejects.toBeTruthy();await closing;expect(e.effects).toHaveLength(0);expect(e.closed.length).toBe(e.opened.length);
});
it('reserves bounded pipeline origins before request traps and refuses capacity without parsing',async()=>{
 const e=await f.pipeline();const issued=deferred<void>();const release=deferred<void>();const ports={...e.ports,inventory:{...e.ports.inventory,open:async(...args:Parameters<typeof e.ports.inventory.open>)=>{issued.resolve();await release.promise;return e.ports.inventory.open(...args);}}};
 const first=e.pipeline.tickWithPorts(e.request,operation(),ports);await issued.promise;
 const second=e.pipeline.tickWithPorts({...e.request,attemptId:'00000000-0000-4000-8000-000000000999'},operation(),ports);void second.result.catch(()=>undefined);
 let calls=0;const forbidden=new Proxy(e.request,{getOwnPropertyDescriptor(){calls++;throw Error('must refuse before capture');}});
 const refused=e.pipeline.tickWithPorts(forbidden,operation(),ports);await expect(refused.result).rejects.toMatchObject({reason:'capacity'});expect(calls).toBe(0);
 release.resolve();expect((await first.result).state).toBe('cleaned');await first.settled;await expect(second.result).rejects.toMatchObject({reason:'conflict'});await expect(second.settled).rejects.toBeTruthy();
});
it('keeps corrupted durable replies as failures rather than pending or cleaned',async()=>{
 const e=await f.pipeline();const receive=Reflect.get(e.owner,'receive') as (reply:unknown)=>void;let changed=false;
 Reflect.set(e.owner,'receive',(reply:unknown)=>{const value=reply&&typeof reply==='object'?Reflect.get(reply,'value'):undefined;
  if(!changed&&value&&typeof value==='object'&&Reflect.has(value,'stored')){changed=true;Reflect.set(value,'stored',{planIdentity:'f'.repeat(64),plan:{}});}receive.call(e.owner,reply);});
 const work=e.pipeline.tickWithPorts(e.request,operation(),e.ports);await expect(work.result).rejects.toMatchObject({code:'unavailable'});await expect(work.settled).rejects.toBeTruthy();expect(e.effects).toHaveLength(0);expect(changed).toBe(true);
});
