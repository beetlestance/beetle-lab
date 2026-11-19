import {expect,it} from 'vitest';
import {pendingRunHistorySummary,validateApi} from '@beetle/contracts/api';
import type {Run,RunHistorySummary,RunMetricOverview} from '@beetle/contracts/api';
import template from '../../../../../contracts/fixtures/api/valid/run-metric-overview.json' with {type:'json'};
import {run} from '../test-fixtures.js';
import {headline} from './headline.js';
const current:Run={...run(),state:'finished',outcome:'passed'};
function overview(patch:Partial<RunMetricOverview>={}):RunMetricOverview{
 const checked=validateApi('RunMetricOverview',{...template,id:current.id,scope:current.scope,attemptId:current.activeAttemptId,testDurationMs:60000,requestsPerSecond:5,...patch});
 if(!checked.ok)throw Error('Invalid synthetic overview');return checked.value;
}
const historical:RunHistorySummary={...pendingRunHistorySummary(current),availability:'ready',source:overview().source!,testDurationMs:2000,requestsPerSecond:99,httpP95:{source:'histogram-estimate',scale:4,estimate:999,lower:998,upper:1000},httpFailureRatio:0.9};
it('uses already-read overview traffic while indexed history is not available',()=>{
 const result=headline(current,'Checkout',null,null,{measurements:overview()});
 expect(result.sentence).toContain('Averaged 5 requests a second over 1 minute.');expect(result.sentence).toContain('3 ms');
});
it('keeps a ready overview as one source instead of filling its nulls from an older index',()=>{
 expect(headline(current,'Checkout',historical,null,{measurements:overview({testDurationMs:null,requestsPerSecond:null,latency:null,failure:null})}).sentence).toBe('');
});
it('retains the indexed fallback without a ready overview and preserves measured zero traffic',()=>{
 expect(headline(current,'Checkout',historical,null).sentence).toContain('Averaged 99 requests a second over 2 seconds.');
 expect(headline(current,'Checkout',historical,null,{measurements:overview({requestsPerSecond:0})}).sentence).toContain('Averaged 0 requests a second over 1 minute.');
});
it('makes passed phone traffic prominent without repeating its average in the sentence',()=>{
 const result=headline(current,'Checkout',historical,null,{measurements:overview(),phone:true});
 expect(result.title).toBe('Averaged 5 a second over 1 minute');
 expect(result.sentence).not.toContain('Averaged');expect(result.sentence).toMatch(/p95/i);
 expect(headline(current,'Checkout',historical,null,{measurements:overview({requestsPerSecond:0}),phone:true}).title).toContain('Averaged 0');
});
it('does not fill a missing phone title field from history, conceal failure, or imply a restored run resumed',()=>{
 expect(headline(current,'Checkout',historical,null,{measurements:overview({requestsPerSecond:null}),phone:true}).title).toBe('Checkout passed');
 expect(headline({...current,outcome:'failed'},'Checkout',historical,null,{measurements:overview(),phone:true}).title).toBe('Checkout failed');
 expect(headline({...current,state:'active',outcome:'pending'},'Checkout',historical,null,{measurements:overview(),phone:true,readOnly:true}).title).toContain('at backup');
});
