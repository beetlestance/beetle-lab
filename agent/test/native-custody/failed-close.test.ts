import { expect, it } from 'vitest';
import { dirname } from 'node:path';
import { nativeCustody } from '../../src/collection/native-custody/index.js';
import { rangeFixture, tracking } from '../output-range/fixture.js';
const f=rangeFixture();
it('keeps failed original closes strongly owned with lane/aggregate credit and scope exclusion',async()=>{
 const artifact=await f.artifact('data.bin','synthetic');await f.write(f.result([artifact]));
 const t=tracking({closeDone:path=>{if(path===f.directory())throw Error('synthetic close failure');}});
 const operation=f.range(await f.rangeOptions(artifact),t.ports);expect(await operation.result).toEqual({ok:false,reason:'io'});
 await operation.quiesced;await expect(operation.close()).rejects.toMatchObject({reason:'io'});
 expect(nativeCustody.status()).toEqual({retained:1,collection:0,range:1,cleanup:0});
 const cleanup=nativeCustody.reserve('cleanup')!;cleanup.own({});expect(()=>cleanup.bind(dirname(f.directory()))).toThrow();cleanup.release();
 expect(operation.close()).toBe(operation.close());expect(t.closed.length).toBe(t.opened.length);
 expect(nativeCustody.status().retained).toBe(1);
});
