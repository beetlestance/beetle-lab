import {expect,it} from 'vitest';
import {rangeFixture,tracking} from './fixture.js';
import type {OutputRangeOptions,OutputCollectionOptions} from '../../src/collection/output/index.js';
const f=rangeFixture();
it.each(['collection','range'] as const)('retains two failed native %s owners and refuses a third before capture',async kind=>{
 const artifact=await f.artifact('data.bin','synthetic');const result=f.result([artifact]);await f.write(result);
 const options=kind==='range'?await f.rangeOptions(artifact):f.options(result);
 const issue=(input:typeof options,ports?:ReturnType<typeof tracking>['ports'])=>kind==='range'?f.range(input as OutputRangeOptions,ports):f.collect(input as OutputCollectionOptions,ports);
 const failures=[];
 for(let n=0;n<2;n++){
  const t=tracking({closeDone:path=>{if(path===f.directory())throw Error('private native close detail');}});
  const original=issue(options,t.ports);failures.push(original);
  expect(await original.result).toEqual({ok:false,reason:'io'});await original.quiesced;
  const closed=original.close();expect(original.close()).toBe(closed);await expect(closed).rejects.toMatchObject({reason:'io'});
  expect(t.closed.length).toBe(t.opened.length);expect(new Set(t.closed).size).toBe(t.closed.length);
 }
 let invoked=0;const forbidden=new Proxy(options,{getOwnPropertyDescriptor(){invoked++;throw Error('must refuse before capture');}});
 const refused=issue(forbidden);expect(await refused.result).toEqual({ok:false,reason:'busy'});await refused.quiesced;await refused.close();expect(invoked).toBe(0);
 for(const original of failures)await expect(original.close()).rejects.toMatchObject({reason:'io'});
});
