import { expect,it } from 'vitest';
import { fixture } from './fixtures.js';
import { deferred } from '../output-collection/fixture.js';
import { nativeCustody } from '../../src/collection/native-custody/index.js';
const f=fixture();
it('owns a late original open after cancellation, performs no late IO, and drains actual close before releasing cleanup credit',async()=>{
 const e=await f.inventory();const issued=deferred<void>();const release=deferred<void>();const controller=new AbortController();
 const ports={...e.ports,open:async(...args:Parameters<typeof e.ports.open>)=>{issued.resolve();await release.promise;return e.ports.open(...args);}};
 const work=e.inventory.prepareWithPorts(e.token,{deadline:performance.now()+10000,signal:controller.signal},ports);await issued.promise;controller.abort();
 expect(await work.result).toEqual({ok:false,reason:'cancelled'});expect(nativeCustody.status().cleanup).toBe(1);
 let quiet=false;void work.quiesced.then(()=>{quiet=true;});await Promise.resolve();expect(quiet).toBe(false);
 release.resolve();await work.close();await work.quiesced;expect(e.opened).toHaveLength(1);expect(e.closed).toHaveLength(1);expect(nativeCustody.status().cleanup).toBe(0);
});
it('invalidates held preparation on producer-owner close before another native dispatch',async()=>{
 const e=await f.inventory();const issued=deferred<void>();const release=deferred<void>();let calls=0;
 const ports={...e.ports,mount:async()=>{calls++;issued.resolve();await release.promise;return 'synthetic-mount';}};
 const work=e.inventory.prepareWithPorts(e.token,{deadline:performance.now()+10000},ports);await issued.promise;await e.coordinator.close();release.resolve();
 expect(await work.result).toMatchObject({ok:false});await work.quiesced;expect(calls).toBe(1);expect(e.closed.length).toBe(e.opened.length);
});
it('retains an original failed close and its scope/credit after quiesced, and close stays rejected',async()=>{
 const e=await f.inventory();const ports={...e.ports,open:async(...args:Parameters<typeof e.ports.open>)=>{const handle=await e.ports.open(...args);
  if(String(args[0])===e.task)handle.close=async()=>{throw Error('synthetic close failure');};return handle;}};
 const work=e.inventory.prepareWithPorts(e.token,{deadline:performance.now()+10000},ports);expect(await work.result).toEqual({ok:false,reason:'io'});await work.quiesced;
 const closing=work.close();expect(work.close()).toBe(closing);await expect(closing).rejects.toMatchObject({reason:'io'});expect(nativeCustody.status().cleanup).toBe(1);
 await expect(e.inventory.close()).rejects.toMatchObject({reason:'io'});
});

it('rejects an enumeration-stream close failure, caches that original and retains cleanup credit',async()=>{
 const e=await f.inventory();let calls=0;const ports={...e.ports,directory:async(path:string)=>{const stream=await e.ports.directory(path);const close=stream.close.bind(stream);
  if(path===e.task)stream.close=async()=>{calls++;await close();throw Error('synthetic enumeration close failure');};return stream;}};
 const work=e.inventory.prepareWithPorts(e.token,{deadline:performance.now()+10000},ports);expect(await work.result).toEqual({ok:false,reason:'io'});await work.quiesced;
 await expect(work.close()).rejects.toMatchObject({reason:'io'});expect(calls).toBe(1);expect(nativeCustody.status().cleanup).toBe(2);
});
