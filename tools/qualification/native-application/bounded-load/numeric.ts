import assert from 'node:assert/strict';
import {captureMetricSeries,metricSeriesIdentity,validateDistribution} from '@beetle/contracts/metrics';
import {record} from '../../resources/values.js';
/** Actual dynamic URLs must not become unbounded metric labels or lose samples. */
export function numeric(input:unknown){
 const row=record(input);assert.equal(row.totalsComplete,true);assert.equal(record(row.measurement).complete,true);assert.equal(row.quantiles,'histogram-estimate');
 assert(Array.isArray(row.totals)&&row.totals.length>0&&row.totals.length<=64);
 const series=row.totals.map(value=>captureMetricSeries(value));const identities=new Set(series.map(metricSeriesIdentity));assert.equal(identities.size,series.length);
 for(const item of series){assert(!Object.hasOwn(item.tags,'url'));if(item.total.kind==='trend')validateDistribution(item.total.distribution);}
 const duration=series.filter(item=>item.scope==='execute'&&item.metric==='http_req_duration');
 assert(duration.length>0);assert(duration.every(item=>item.total.kind==='trend'&&item.total.count===400&&item.total.distribution.count===400));
 const requests=series.filter(item=>item.scope==='execute'&&item.metric==='http_reqs');
 assert(requests.length>0);assert(requests.every(item=>item.total.kind==='counter'&&item.total.sum===400));
 return {series:series.length,identities:identities.size,requestCount:400,durationCount:400,quantiles:'histogram-estimate',totalsComplete:true};
}

export function numericEvidence(input:unknown,expectedScope:{organizationId:string;workspaceId:string;attemptId:string;generation:1}){
 const row=record(input);assert.equal(row.version,4);assert.deepEqual(row.scope,expectedScope);
 assert.equal(row.quantiles,'histogram-estimate');assert.equal(row.windowsRetained,true);
 return numeric(row.metrics);
}
