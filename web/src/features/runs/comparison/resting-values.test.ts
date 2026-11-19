import { expect, it } from 'vitest';
import chart from '../../../../../contracts/fixtures/api/valid/run-chart-history.json' with { type: 'json' };
import overview from '../../../../../contracts/fixtures/api/valid/run-metric-overview.json' with { type: 'json' };
import { validateApi, pendingRunHistorySummary, runMetricOverviewMatches } from '@beetle/contracts/api';
import type { RunChartHistory, RunMetricOverview } from '@beetle/contracts/api';
import { comparisonRestingValue, comparisonNumber } from './resting-values.js';
function fixture() {
 const history = { status:'loaded' as const, value:structuredClone(chart) as RunChartHistory };
 history.value.source!.numericVersion=4;
 const quantile={...history.value.points[0]!.httpP95!,estimate:3,lower:3,upper:3};
 const original=validateApi('RunMetricOverview',structuredClone(overview));if(!original.ok)throw Error('Invalid base overview fixture');
 const scalar:RunMetricOverview = { ...original.value, source:structuredClone(history.value.source), testDurationMs:2000, requestCount:4,
  requestsPerSecond:2, failure:{kind:'rate',numerator:1,sampleCount:4,ratio:.25},
  latency:{kind:'trend',count:4,sum:12,min:3,max:3,mean:3,percentiles:{p50:quantile,p90:quantile,p95:quantile,p99:quantile}} };
 scalar.endpoints=[{request:'r0',requestCount:scalar.requestCount,requestsPerSecond:scalar.requestsPerSecond,failure:scalar.failure,latency:scalar.latency}];
 const checked=validateApi('RunMetricOverview',scalar);if(!checked.ok)throw Error(JSON.stringify(checked));
 if(!runMetricOverviewMatches(checked.value,{id:history.value.id,scope:history.value.scope,attemptId:history.value.attemptId}))throw Error('Overview facts do not match');
 return {history, overview:{status:'loaded' as const,value:checked.value as RunMetricOverview}};
}
it('uses source-bound whole-run values instead of last windows or sampled-point averages',()=>{
 const f=fixture();expect(comparisonRestingValue('requests',f.overview,f.history)).toBe(2);
 expect(comparisonRestingValue('p95',f.overview,f.history)).toBe(f.overview.value.latency!.percentiles.p95.estimate);
 expect(comparisonRestingValue('failures',f.overview,f.history)).toBe(.5);
 expect(comparisonRestingValue('vus',f.overview,f.history)).toBe(f.history.value.meanVus);
 expect(comparisonRestingValue('vus',f.overview,f.history)).not.toBe(f.history.value.points.at(-1)!.vus);
});
it('never fills a missing or foreign aggregate from a plotted endpoint',()=>{
 const f=fixture();f.overview.value.source!.numericSha256='f'.repeat(64);
 for(const metric of ['requests','p95','failures'] as const)expect(comparisonRestingValue(metric,f.overview,f.history)).toBeNull();
 expect(comparisonRestingValue('vus',undefined,f.history)).toBe(f.history.value.meanVus);
 f.history.value.meanVus=null;expect(comparisonRestingValue('vus',f.overview,f.history)).toBeNull();
 const missing=fixture();missing.overview.value.failure=null;expect(comparisonRestingValue('failures',missing.overview,missing.history)).toBeNull();
});
it('does not display positive fractional recorded rates as zero',()=>{
 expect(comparisonNumber(0)).toBe('0');expect(comparisonNumber(.25)).toBe('0.25');
 expect(Number(comparisonNumber(Number.MIN_VALUE))).toBeGreaterThan(0);
 expect(comparisonNumber(1e100).length).toBeLessThan(16);
});

it('uses only a bound retained summary when overview is unavailable, and never backfills ready nulls',()=>{
 const f=fixture();const run={id:f.history.value.id,activeAttemptId:f.history.value.attemptId};
 const summary={...pendingRunHistorySummary(run),availability:'ready' as const,source:structuredClone(f.history.value.source),
  requestCount:4,requestsPerSecond:2,httpP95:f.overview.value.latency!.percentiles.p95,httpFailures:1,httpSamples:4,httpFailureRatio:.25,testDurationMs:2000};
 expect(validateApi('RunHistorySummary',summary).ok).toBe(true);
 expect(comparisonRestingValue('requests',{status:'error'},f.history,summary)).toBe(2);
 expect(comparisonRestingValue('p95',undefined,f.history,summary)).toBe(3);
 expect(comparisonRestingValue('failures',undefined,f.history,summary)).toBe(.5);
 f.overview.value.latency=null;expect(comparisonRestingValue('p95',f.overview,f.history,summary)).toBeNull();
 summary.source!.numericSha256='f'.repeat(64);expect(comparisonRestingValue('requests',undefined,f.history,summary)).toBeNull();
});
