import {expect,it} from 'vitest';
import {chartSampleOrdinals,runChartHistoryMatches,validateApi,createApiClient} from '../../src/api/index.js';
import type {RunChartHistory} from '../../src/api/index.js';
import fixture from '../../fixtures/api/valid/run-chart-history.json' with {type:'json'};
const value=()=>structuredClone(fixture) as RunChartHistory;
const key={id:fixture.id,attemptId:fixture.attemptId,scope:{...fixture.scope,kind:'workspace' as const}};
it('bounds deterministic actual ordinals and preserves endpoints',()=>{
 for(const windows of [0,1,3,899,900,901,3600,65536]){
  const selected=chartSampleOrdinals(windows);expect(selected.length).toBe(Math.min(windows,900));expect(new Set(selected).size).toBe(selected.length);
  if(windows){expect(selected[0]).toBe(1);expect(selected.at(-1)).toBe(windows);}
 }
 expect(()=>chartSampleOrdinals(65537)).toThrow();
});
it('accepts the original and refuses wrong scope, missing endpoints, reordered points and changed intervals',()=>{
 expect(validateApi('RunChartHistory',value()).ok).toBe(true);expect(runChartHistoryMatches(value(),key)).toBe(true);
 const wrongs=[value(),value(),value(),value()];wrongs[0]!.attemptId='00000000-0000-4000-8000-000000000099';
 wrongs[1]!.points.pop();wrongs[2]!.points.reverse();wrongs[3]!.points[0]!.endTimeMs++;
 for(const item of wrongs)expect(runChartHistoryMatches(item,key)).toBe(false);
});
it('refuses invented peak evidence, hidden known windows, fake gap flags and source-free ready values',()=>{
 const wrongs=[value(),value(),value(),value()];wrongs[0]!.observedPeakRequestsPerSecond=0;wrongs[1]!.knownRequestWindows=0;
 wrongs[2]!.points[1]!.gapBefore=true;wrongs[3]!.source=null;
 for(const item of wrongs)expect(runChartHistoryMatches(item,key)).toBe(false);
});
it('refuses to expose sampled points together with a too-large reason',()=>{
 const item=value();item.reason='too_large';expect(runChartHistoryMatches(item,key)).toBe(false);
});
it('enforces route identity through the generated client',async()=>{
 const item=value();item.id='00000000-0000-4000-8000-000000000099';
 const client=createApiClient({baseUrl:'http://synthetic.invalid',fetch:async()=>new Response(JSON.stringify(item),{headers:{'content-type':'application/json'}})});
 expect((await client.getRunChartHistory({params:{organizationId:key.scope.organizationId,workspaceId:key.scope.workspaceId,runId:key.id,attemptId:key.attemptId}})).ok).toBe(false);
});

it('requires the exact peak when every known source window is represented',()=>{
 const item=value();item.observedPeakRequestsPerSecond=1000;
 expect(runChartHistoryMatches(item,key)).toBe(false);
});
