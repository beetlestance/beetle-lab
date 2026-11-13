import {expect,it} from 'vitest';
import {fixture} from '../runtime-retirement/fixtures.js';
import {operation} from '../staging/fixtures.js';
const f=fixture();
it.each(['held','rejected'] as const)('retains the runtime original and close through %s actual Journal termination',async mode=>{
 // Rejected proof deliberately remains owned; the real OS worker is terminated below.
 const e=await f.ready(true,false);const receive=Reflect.get(e.owner,'receive') as (reply:unknown)=>void;
 let enter!:()=>void;const committed=new Promise<void>(resolve=>{enter=resolve;});let held=false;
 Reflect.set(e.owner,'receive',(reply:unknown)=>{const value=reply&&typeof reply==='object'?Reflect.get(reply,'value'):undefined;
  if(!held&&value&&typeof value==='object'&&Reflect.get(value,'association')){held=true;enter();return;}receive.call(e.owner,reply);});
 const terminate=Reflect.get(e.owner,'terminate') as ()=>Promise<number>;let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let original:Promise<number>|undefined;
 Reflect.set(e.owner,'terminate',()=>{original??=terminate.call(e.owner).then(async code=>{await gate;if(mode==='rejected')throw Error('termination proof failed');return code;});return original;});
 const work=e.runtime.retire(e.producer,operation());let settled=false;void work.then(()=>{settled=true;},()=>{settled=true;});
 await committed;const aborted=e.owner.abort();void aborted.catch(()=>{});let closed=false;const closing=e.runtime.close();void closing.then(()=>{closed=true;},()=>{closed=true;});
 try{
  await new Promise<void>(resolve=>setImmediate(resolve));expect(settled).toBe(false);expect(closed).toBe(false);expect(e.runtime.status().retained).toBe(1);expect(e.docker.mutations()).toHaveLength(0);
  release();
  if(mode==='held'){await aborted;await expect(work).rejects.toBeTruthy();await expect(closing).rejects.toMatchObject({reason:'unresolved'});}
  else{await expect(aborted).rejects.toThrow('termination proof failed');await new Promise<void>(resolve=>setImmediate(resolve));expect(settled).toBe(false);expect(closed).toBe(false);expect(e.runtime.status().retained).toBe(1);}
  expect(e.docker.mutations()).toHaveLength(0);
 }finally{release();Reflect.set(e.owner,'terminate',terminate);}
});
