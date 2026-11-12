import {expect,it} from 'vitest';
import {captureOutputBinding} from '../../src/domain/output-owner/index.js';
import {record,id} from '../files/output-bytes/fixture.js';
import {exportBinding} from './fixture.js';
it('preserves Run identity and freezes a disjoint export owner with exact expectation scope',()=>{
 const run=record().binding;expect(captureOutputBinding(run)).toEqual(run);
 const original=exportBinding();const value=captureOutputBinding(original);expect(value).toEqual(original);expect(value).not.toHaveProperty('key.runId');
 expect(Object.isFrozen(value)).toBe(true);expect(Object.isFrozen(value.key.attempt)).toBe(true);expect(Object.isFrozen(original)).toBe(false);
 expect(()=>captureOutputBinding({...original,key:{...original.key,runId:id(3)}})).toThrow();
 expect(()=>captureOutputBinding({...original,expectation:{...original.expectation,workspaceId:id(9)}})).toThrow();
 expect(()=>captureOutputBinding({...original,purpose:'performance'})).toThrow();
});
it('refuses accessors, symbols, unknown data and excessive values without invoking getters',()=>{
 const original=exportBinding();let calls=0;
 const hostile={...original,get expectation(){calls++;return original.expectation;}};
 for(const value of [hostile,{...original,[Symbol('hidden')]:true},{...original,unknown:true},
 {...original,expectation:{...original.expectation,maximumBuildBytes:67108865}},
 {...original,key:{...original.key,attempt:{...original.key.attempt,generation:2}}}]) expect(()=>captureOutputBinding(value)).toThrow();
 expect(calls).toBe(0);
});
