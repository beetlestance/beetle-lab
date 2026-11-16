import { expect,it } from 'vitest';
import { fixture,post } from './fixtures.js';
import { deferred } from '../output-collection/fixture.js';
const f=fixture();
it('keeps the native original owned after TCP disconnect and waits during server close',async()=>{
 const issued=deferred<void>();const release=deferred<void>();
 const e=await f.http(16,ports=>({...ports,inventory:{...ports.inventory,open:async(...args:Parameters<typeof ports.inventory.open>)=>{
  issued.resolve();await release.promise;return ports.inventory.open(...args);
 }}}));
 const sent=post(e.origin,e.path,e.headers,e.request);void sent.result.catch(()=>undefined);
 let closed=false;let closing:Promise<void>|undefined;
 try{
  await issued.promise;sent.req.destroy();
  closing=e.server.close().then(()=>{closed=true;});
  await new Promise<void>(resolve=>setImmediate(resolve));
  expect(closed).toBe(false);expect(e.pipeline.status().retained).toBe(1);
 }finally{release.resolve();}
 await closing;await expect(sent.result).rejects.toBeTruthy();
 expect(e.effects).toHaveLength(0);expect(e.closed.length).toBe(e.opened.length);
});
