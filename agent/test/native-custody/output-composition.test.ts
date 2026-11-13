import { expect, it } from 'vitest';
import { dirname } from 'node:path';
import { nativeCustody } from '../../src/collection/native-custody/index.js';
import { rangeFixture, tracking, deferred } from '../output-range/fixture.js';
const f = rangeFixture();
it('refuses actual collection/range filesystem dispatch under a cleanup scope, then restores both lanes', async () => {
 const artifact=await f.artifact('data.bin','synthetic');const result=f.result([artifact]);await f.write(result);
 const collection=f.options(result);const range=await f.rangeOptions(artifact);const cleanup=nativeCustody.reserve('cleanup')!;cleanup.own({});cleanup.bind(dirname(f.directory()));
 const t=tracking();try {
  expect(await f.collect(collection,t.ports).result).toEqual({ok:false,reason:'busy'});
  expect(await f.range(range,t.ports).result).toEqual({ok:false,reason:'busy'});expect(t.opened).toHaveLength(0);
 }finally{cleanup.release();}
 expect(await f.collect(collection).result).toMatchObject({ok:true});expect(await f.range(await f.rangeOptions(artifact)).result).toMatchObject({ok:true});
});
it('retains the real held range owner and excludes cleanup after cancellation until its original close settles', async () => {
 const artifact=await f.artifact('data.bin','synthetic');await f.write(f.result([artifact]));
 const issued=deferred<void>();const release=deferred<void>();const controller=new AbortController();
 const t=tracking({close:async path=>{if(path===f.directory()){issued.resolve();await release.promise;}}});
 const reader=f.range(await f.rangeOptions(artifact,{signal:controller.signal}),t.ports);await issued.promise;controller.abort();
 expect(await reader.result).toEqual({ok:false,reason:'cancelled'});expect(nativeCustody.status().range).toBe(1);
 const blocked=nativeCustody.reserve('cleanup')!;blocked.own({});expect(()=>blocked.bind(dirname(f.directory()))).toThrow();blocked.release();
 release.resolve();await reader.close();await reader.quiesced;expect(nativeCustody.status().range).toBe(0);
 const cleanup=nativeCustody.reserve('cleanup')!;cleanup.own({});cleanup.bind(dirname(f.directory()));cleanup.release();
});
