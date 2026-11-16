import { expect,it } from 'vitest';
import { nativeCustody } from '../../src/collection/native-custody/index.js';
import { deferred } from '../output-collection/fixture.js';
import { fixture } from './fixtures.js';
const f=fixture();
it('retains a late actual open after cancellation and closes it without issuing more native work',async()=>{
 const e=await f.ready();const issued=deferred<void>();const release=deferred<void>();const abort=new AbortController();
 const ports={...e.ports,filesystem:{...e.ports.filesystem,open:async(...args:Parameters<typeof e.ports.filesystem.open>)=>{
  issued.resolve();await release.promise;return e.ports.filesystem.open(...args);
 }}};
 const work=e.native.finalizeWithPorts(e.token,{deadline:performance.now()+10000,signal:abort.signal},ports);await issued.promise;abort.abort();
 expect(await work.result).toEqual({ok:false,reason:'cancelled'});expect(nativeCustody.status().cleanup).toBe(1);
 release.resolve();await work.close();await work.quiesced;expect(e.opened).toHaveLength(1);expect(e.closed).toHaveLength(1);
 expect(nativeCustody.status().cleanup).toBe(0);expect(e.docker.calls).toHaveLength(0);
});
it('revokes a held producer observation before another descriptor is dispatched',async()=>{
 const e=await f.ready();const issued=deferred<void>();const release=deferred<void>();
 const ports={...e.ports,filesystem:{...e.ports.filesystem,open:async(...args:Parameters<typeof e.ports.filesystem.open>)=>{
  issued.resolve();await release.promise;return e.ports.filesystem.open(...args);
 }}};
 const work=e.native.finalizeWithPorts(e.token,{deadline:performance.now()+10000},ports);await issued.promise;await e.producer.close();release.resolve();
 expect(await work.result).toMatchObject({ok:false});await work.quiesced;expect(e.opened).toHaveLength(1);expect(e.closed).toHaveLength(1);
 expect(e.docker.calls).toHaveLength(0);
});
it('holds the actual original root close through shutdown and never commits a late receipt',async()=>{
 const e=await f.ready();const issued=deferred<void>();const release=deferred<void>();
 const ports={...e.ports,filesystem:{...e.ports.filesystem,open:async(...args:Parameters<typeof e.ports.filesystem.open>)=>{
  const handle=await e.ports.filesystem.open(...args);const close=handle.close.bind(handle);
  if(String(args[0])===e.rootPath)handle.close=async()=>{issued.resolve();await release.promise;await close();};return handle;
 }}};
 const work=e.native.finalizeWithPorts(e.token,{deadline:performance.now()+10000},ports);await issued.promise;let closed=false;
 const closing=e.native.close().then(()=>{closed=true;});expect(await work.result).toMatchObject({ok:false});await Promise.resolve();
 expect(closed).toBe(false);expect(nativeCustody.status().cleanup).toBe(1);release.resolve();await closing;await work.quiesced;
 expect(e.closed.length).toBe(e.opened.length);expect(e.docker.calls).toHaveLength(4);expect(nativeCustody.status().cleanup).toBe(0);
});
