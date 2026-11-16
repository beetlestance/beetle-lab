import {expect,it} from 'vitest';
import {failureFacts} from './failure.js';
it('retains closed failed-phase hints without raw failures, identities or partial acceptance',()=>{
 const revision='a'.repeat(40);const privateValue='/Users/private/token-123';
 const row={sourceRevision:revision,architecture:'amd64',phase:'trials',cleanupVerified:true,
  results:{parentFailure:'Native benchmark or observer failed '+privateValue,nativeOriginals:[{status:'rejected',error:'EACCES '+privateValue+'\n at executeTrial (/private/synthetic/container.js:123:45)'}]}};
 const f=failureFacts(row,{status:'failed',orderlyDrained:true,results:[{}],failure:privateValue},undefined,revision);
 expect(f).toMatchObject({phase:'trials',completedTrials:1,errorCodes:['EACCES'],hints:['native-or-observer'],componentPassed:false});
 expect(f?.sites).toEqual([{file:'container',line:123,column:45}]);
 expect(JSON.stringify(f)).not.toContain('/private/synthetic');
 expect(JSON.stringify(f)).not.toContain(privateValue);expect(failureFacts(row,null,null,'b'.repeat(40))).toBeNull();
});
