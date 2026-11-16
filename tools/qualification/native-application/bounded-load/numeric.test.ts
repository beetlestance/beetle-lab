import {expect,it} from 'vitest';
import {DurationHistogram} from '@beetle/contracts/metrics';
import {numeric,numericEvidence} from './numeric.js';
function fixture(count=400){
 const histogram=new DurationHistogram();for(let i=0;i<count;i++)histogram.record(1);
 return {totalsComplete:true,measurement:{complete:true,sourceTimeMs:1000},quantiles:'histogram-estimate',windowCoverage:{complete:true,latePoints:0,markerDelayDroppedBuckets:0},totals:[
  {metric:'http_req_duration',kind:'trend',scope:'execute',tags:{},total:{kind:'trend',count,sum:count,min:1,max:1,mean:1,distribution:histogram.snapshot()}},
  {metric:'http_reqs',kind:'counter',scope:'execute',tags:{},total:{kind:'counter',sum:count}}]};
}
it('requires complete, bounded final totals with exact request/histogram counts',()=>{
 expect(numeric(fixture())).toMatchObject({series:2,requestCount:400,durationCount:400,totalsComplete:true});
});
it('rejects sample loss, partial final evidence, duplicate identities and dynamic URL tags',()=>{
 const source=fixture();expect(()=>numeric({...source,totalsComplete:false})).toThrow();
 expect(()=>numeric({...source,totals:[...source.totals,source.totals[0]]})).toThrow();
 expect(()=>numeric({...source,totals:source.totals.map(item=>({...item,tags:{url:'/work?key=1'}}))})).toThrow();
 const trend=source.totals[0]!;expect(()=>numeric({...source,totals:[{...trend,total:{...trend.total,count:399}},source.totals[1]]})).toThrow();
});

it('checks the actual version4 artifact envelope and exact attempt scope before its nested metrics',()=>{
 const scope={organizationId:'org',workspaceId:'workspace',attemptId:'attempt',generation:1 as const};
 const source={version:4,scope,quantiles:'histogram-estimate',windowsRetained:true,metrics:fixture()};
 expect(numericEvidence(source,scope)).toMatchObject({requestCount:400});
 expect(()=>numericEvidence({...source,scope:{...scope,attemptId:'other'}},scope)).toThrow();
 expect(()=>numericEvidence({...source,version:3},scope)).toThrow();
 expect(()=>numericEvidence({...source,metrics:null},scope)).toThrow();
});

it('supports an explicit larger fixed-work oracle without changing the old default or accepting partial counts',()=>{
 expect(numeric(fixture(4000),4000)).toMatchObject({requestCount:4000,durationCount:4000});
 expect(()=>numeric(fixture(4000))).toThrow();expect(()=>numeric(fixture(),0)).toThrow();
});
