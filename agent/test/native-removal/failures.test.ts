import { expect,it } from 'vitest';
import { lstat } from 'node:fs/promises';
import { fixture } from './fixtures.js';
import { deferred } from '../output-collection/fixture.js';
import { nativeCustody } from '../../src/collection/native-custody/index.js';
const f=fixture();const operation=()=>({deadline:performance.now()+10000});
it('retains a held unlink original after cancellation, refuses a second effect and recovers only its exact absence',async()=>{
 const e=await f.ready();const issued=deferred<void>();const release=deferred<void>();const controller=new AbortController();
 const ports={...e.ports,rmdir:async(path:string)=>{await e.ports.rmdir(path);issued.resolve();await release.promise;}};
 const pending=e.removal.stepWithPorts(e.token,{...operation(),signal:controller.signal},ports);void pending.catch(()=>undefined);await issued.promise;controller.abort();
 expect(e.removal.stepWithPorts(e.token,operation(),e.ports)).toBe(pending);expect(e.effects).toHaveLength(1);expect(nativeCustody.status().cleanup).toBe(1);
 release.resolve();await expect(pending).rejects.toBeTruthy();expect((await e.owner.cleanupProgress.read(e.plan))?.removedCount).toBe(0);
 expect((await e.removal.stepWithPorts(e.token,operation(),e.ports)).removedCount).toBe(1);expect(e.effects).toHaveLength(1);
});
it('requires a successful actual parent fsync before advancing and reconciles a prior completed unlink on retry',async()=>{
 const e=await f.ready();let failed=false;const ports={...e.ports,open:async(...args:Parameters<typeof e.ports.open>)=>{const handle=await e.ports.open(...args);const sync=handle.sync.bind(handle);
  handle.sync=async()=>{await sync();if(!failed){failed=true;throw Error('synthetic fsync reply loss');}};return handle;}};
 await expect(e.removal.stepWithPorts(e.token,operation(),ports)).rejects.toBeTruthy();expect(e.effects).toHaveLength(1);expect((await e.owner.cleanupProgress.read(e.plan))?.removedCount).toBe(0);
 expect((await e.removal.stepWithPorts(e.token,operation(),e.ports)).removedCount).toBe(1);expect(e.effects).toHaveLength(1);
});
it('retains actual failed native close, scope and credit and never advances or retries another effect',async()=>{
 const e=await f.ready();const ports={...e.ports,open:async(...args:Parameters<typeof e.ports.open>)=>{const handle=await e.ports.open(...args);const close=handle.close.bind(handle);
  handle.close=async()=>{await close();if(e.effects.length)throw Error('synthetic native close failure');};return handle;}};
 await expect(e.removal.stepWithPorts(e.token,operation(),ports)).rejects.toMatchObject({reason:'io'});expect(e.effects).toHaveLength(1);
 expect((await e.owner.cleanupProgress.read(e.plan))?.removedCount).toBe(0);await expect(e.removal.stepWithPorts(e.token,operation(),e.ports)).rejects.toMatchObject({reason:'io'});expect(e.effects).toHaveLength(1);
 expect(nativeCustody.status().cleanup).toBe(1);await expect(e.removal.close()).rejects.toMatchObject({reason:'io'});
 await expect(lstat(e.task)).resolves.toBeTruthy();
});
