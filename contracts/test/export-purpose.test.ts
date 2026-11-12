import { createHash } from 'node:crypto';
import { expect,it,vi } from 'vitest';
import { captureExportExpectation,captureExportResultForExpectation,exportExpectation,verifyExecutionResultSeal } from '../src/index.js';
import engine from '../fixtures/seal-v1/passed-result.json' with {type:'json'};
import exported from '../fixtures/export-v1/result.json' with {type:'json'};
import assignment from '../fixtures/export-v1/assignment.json' with {type:'json'};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
it.each([['performance',engine],['standalone',exported]] as const)('keeps %s seal failures in their original codec without purpose fallback',(_,value)=>{
  expect(verifyExecutionResultSeal(value,hash)).toEqual({ok:true,value});
  const altered=structuredClone(value);altered.seal.sha256='0'.repeat(64);
  expect(verifyExecutionResultSeal(altered,hash)).toEqual({ok:false,code:'seal_mismatch'});
});
it('rejects a purpose accessor without invoking it or the digest provider',()=>{
  const value={...exported};let getters=0;Object.defineProperty(value,'purpose',{enumerable:true,get(){getters++;throw new Error('private');}});
  const provider=vi.fn(hash);expect(verifyExecutionResultSeal(value,provider)).toEqual({ok:false,code:'invalid_result'});
  expect(getters).toBe(0);expect(provider).not.toHaveBeenCalled();
});
it('projects only compact immutable scope/options binding and checks it against the sealed export',()=>{
  const expected=exportExpectation(assignment,hash);expect(Object.keys(expected).sort()).toEqual(['assignmentDigest','attemptId','exportId','maximumBuildBytes','organizationId','workspaceId']);
  expect(Object.isFrozen(expected)).toBe(true);expect(JSON.stringify(expected).length).toBeLessThan(1024);
  expect(captureExportResultForExpectation(exported,expected,hash)).toEqual(exported);
  expect(()=>captureExportResultForExpectation(exported,{...expected,assignmentDigest:'d'.repeat(64)},hash)).toThrow(expect.objectContaining({code:'binding_mismatch'}));
  expect(()=>captureExportExpectation({...expected,maximumBuildBytes:0})).toThrow();
  expect(()=>captureExportExpectation({...expected,config:{}})).toThrow();
});
