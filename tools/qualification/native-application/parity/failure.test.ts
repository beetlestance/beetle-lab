import {AssertionError} from 'node:assert';
import {expect,it} from 'vitest';
import {parityFailure,publicParityFailure} from './failure.js';
import {publicFailure} from '../conformance/failure.js';
const canary='PRIVATE_SECRET';const revision='a'.repeat(40);
it('captures only a fixed parity source location from a private assertion',()=>{
 const error=new AssertionError({message:canary,actual:canary,expected:'finished'});
 error.stack='AssertionError: '+canary+'\n at settled (/private/native-application/parity/result.ts:17:3)';
 expect(publicParityFailure(parityFailure(error))).toEqual({code:'assertion',site:{file:'parity-result',line:17,column:3},publicStatus:null});
});
it('bounds and strips uploaded code, location and HTTP facts',()=>{
 const value=publicParityFailure({code:canary,site:{file:canary,line:10000,column:1},publicStatus:600,private:canary});
 expect(value).toEqual({code:'internal',site:null,publicStatus:null});expect(JSON.stringify(value)).not.toContain(canary);
 expect(publicParityFailure({code:'public_api',site:{file:'public-api',line:14,column:11},publicStatus:503})).toEqual({code:'public_api',site:{file:'public-api',line:14,column:11},publicStatus:503});
 for(const line of [0,-1,1.5,Infinity])expect(publicParityFailure({site:{file:'parity-run',line,column:1}}).site).toBeNull();
});
it('adds diagnosis only to source-bound engine failures without a partial pass',()=>{
 const row={sourceRevision:revision,architecture:'amd64',status:'failed',phase:'executors',cleanupVerified:true,
 failure:{code:'assertion',site:{file:'parity-result',line:17,column:3},private:canary},private:canary};
 const value=publicFailure(row,'engine-executors',revision);expect(value.status).toBe('failed');expect(value.diagnosis?.site?.line).toBe(17);expect(JSON.stringify(value)).not.toContain(canary);
 expect(publicFailure({...row,sourceRevision:'b'.repeat(40)},'engine-executors',revision).diagnosis).toBeNull();
 expect(publicFailure(row,'long-stream',revision).diagnosis).toBeNull();
});
