import { expect,it } from 'vitest';
import { fixture } from './fixtures.js';
import { deferred } from '../output-collection/fixture.js';
const f=fixture();const operation=()=>({deadline:performance.now()+10000});
it('serializes the original through a held committed progress reply and never issues a second unlink early',async()=>{
 const e=await f.ready();const receive=Reflect.get(e.owner,'receive') as (reply:unknown)=>void;const issued=deferred<unknown>();let held=false;
 Reflect.set(e.owner,'receive',(reply:unknown)=>{
  const value=reply&&typeof reply==='object'?Reflect.get(reply,'value'):undefined;const progress=value&&typeof value==='object'?Reflect.get(value,'progress'):undefined;
  if(!held&&progress&&typeof progress==='object'&&Reflect.get(progress,'removedCount')===1){held=true;issued.resolve(reply);return;}receive.call(e.owner,reply);
 });
 const pending=e.removal.stepWithPorts(e.token,operation(),e.ports);const reply=await issued.promise;
 expect(e.effects).toHaveLength(1);expect(e.removal.stepWithPorts(e.token,operation(),e.ports)).toBe(pending);expect(e.removal.status().retained).toBe(1);
 expect((await e.owner.cleanupProgress.read(e.plan))?.removedCount).toBe(1);expect(e.effects).toHaveLength(1);
 receive.call(e.owner,reply);expect((await pending).removedCount).toBe(1);expect((await e.removal.stepWithPorts(e.token,operation(),e.ports)).removedCount).toBe(2);expect(e.effects).toHaveLength(2);
});
it('rechecks complete presence after the cleaning commit and refuses a disappearing next leaf before effect',async()=>{
 const e=await f.ready();const receive=Reflect.get(e.owner,'receive') as (reply:unknown)=>void;const issued=deferred<unknown>();let held=false;
 Reflect.set(e.owner,'receive',(reply:unknown)=>{const value=reply&&typeof reply==='object'?Reflect.get(reply,'value'):undefined;const progress=value&&typeof value==='object'?Reflect.get(value,'progress'):undefined;
  if(!held&&progress&&typeof progress==='object'&&Reflect.get(progress,'version')===2){held=true;issued.resolve(reply);return;}receive.call(e.owner,reply);});
 const pending=e.removal.stepWithPorts(e.token,operation(),e.ports);void pending.catch(()=>undefined);const reply=await issued.promise;
 const next=e.plan.entries.at(-1)!;const {rm}=await import('node:fs/promises');const {join}=await import('node:path');await rm(join(e.task,next.path),{recursive:true});
 receive.call(e.owner,reply);await expect(pending).rejects.toBeTruthy();expect(e.effects).toHaveLength(0);expect((await e.owner.cleanupProgress.read(e.plan))?.removedCount).toBe(0);
});
