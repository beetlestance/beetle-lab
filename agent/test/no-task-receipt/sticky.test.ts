import { expect,it } from 'vitest';
import type { Worker } from 'node:worker_threads';
import { nativeCustody } from '../../src/collection/native-custody/index.js';
import { deferred } from '../output-collection/fixture.js';
import { fixture } from './fixtures.js';
const f=fixture();
it('retains failed actual root-close custody and caches the failure without publishing a receipt',async()=>{
 const e=await f.ready();let closes=0;
 const ports={...e.ports,filesystem:{...e.ports.filesystem,open:async(...args:Parameters<typeof e.ports.filesystem.open>)=>{
  const handle=await e.ports.filesystem.open(...args);const close=handle.close.bind(handle);
  if(String(args[0])===e.rootPath)handle.close=async()=>{closes++;await close();throw Error('synthetic root close rejection');};return handle;
 }}};
 const work=e.native.finalizeWithPorts(e.token,{deadline:performance.now()+10000},ports);
 expect(await work.result).toEqual({ok:false,reason:'io'});await work.quiesced;
 const closing=work.close();expect(work.close()).toBe(closing);await expect(closing).rejects.toMatchObject({reason:'io'});
 expect(closes).toBe(1);expect(e.native.status().retained).toBe(1);expect(nativeCustody.status().cleanup).toBe(1);
 await expect(e.native.close()).rejects.toMatchObject({reason:'io'});
});
it('retains an actually issued receipt carrier when worker termination rejects, even after fixture reaping',async()=>{
 const e=await f.ready();const worker=Reflect.get(e.owner,'worker') as Worker;const terminate=worker.terminate.bind(worker);
 const committed=deferred<void>();const receive=Reflect.get(e.owner,'receive') as (reply:unknown)=>void;
 Reflect.set(e.owner,'receive',(reply:unknown)=>{
  const value=reply&&typeof reply==='object'?Reflect.get(reply,'value'):undefined;
  if(value&&typeof value==='object'&&Reflect.get(value,'receiptIdentity')){committed.resolve();return;}receive.call(e.owner,reply);
 });
 worker.terminate=()=>Promise.reject(Error('synthetic worker termination rejection'));
 const work=e.native.finalizeWithPorts(e.token,{deadline:performance.now()+10000},e.ports);
 try{
  await committed.promise;await expect(e.owner.abort()).rejects.toThrow('synthetic worker termination rejection');
  expect(await work.result).toMatchObject({ok:false});await work.quiesced;await expect(work.close()).rejects.toMatchObject({reason:'io'});
  expect(e.native.status().retained).toBe(1);expect(nativeCustody.status().cleanup).toBe(2);
 }finally{await terminate();f.releaseTerminated(e.owner);}
 await expect(e.native.close()).rejects.toMatchObject({reason:'io'});
});
