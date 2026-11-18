import { expect, it } from 'vitest';
import { createApiClient, runMetricOverviewMatches, validateApi } from '../../src/api/index.js';
import fixture from '../../fixtures/api/valid/run-metric-overview.json' with { type: 'json' };
import type { RunMetricOverview } from '../../src/api/index.js';
const value = () => structuredClone(fixture) as RunMetricOverview;
const key = { id: fixture.id, attemptId: fixture.attemptId, scope: { ...fixture.scope, kind: 'workspace' as const } };
it('binds scope, run and attempt even for a schema-valid response', () => {
  for (const patch of [{id:'00000000-0000-4000-8000-000000000099'}, {attemptId:'00000000-0000-4000-8000-000000000099'}, {scope:{...key.scope,workspaceId:'00000000-0000-4000-8000-000000000099'}}])
    expect(runMetricOverviewMatches({...value(),...patch},key)).toBe(false);
});
it('rejects invented rates, inconsistent checks, duplicate endpoint ordinals and source-free ready data', () => {
  const cases=[value(),value(),value(),value()];
  cases[0]!.requestsPerSecond=100;
  cases[1]!.checks={passed:9,total:8,ratio:1};
  cases[2]!.endpoints.push({...cases[2]!.endpoints[0]!});
  cases[3]!.source=null;
  for(const item of cases)expect(runMetricOverviewMatches(item,key)).toBe(false);
});
it('requires unavailable values to stay unknown and enforces the endpoint cap', () => {
  const item=value();item.availability='pending';expect(runMetricOverviewMatches(item,key)).toBe(false);
  const tooMany=value();tooMany.endpoints=Array.from({length:65},()=>({...tooMany.endpoints[0]!}));
  expect(validateApi('RunMetricOverview',tooMany).ok).toBe(false);
});
it('rejects a foreign attempt through the generated client ownership boundary', async () => {
  const item=value();item.attemptId='00000000-0000-4000-8000-000000000099';
  const client=createApiClient({baseUrl:'http://synthetic.invalid',fetch:async()=>new Response(JSON.stringify(item),{headers:{'content-type':'application/json'}})});
  const response=await client.getRunMetricOverview({params:{organizationId:key.scope.organizationId,workspaceId:key.scope.workspaceId,runId:key.id,attemptId:key.attemptId}});
  expect(response.ok).toBe(false);
});

it('rejects endpoint counts that exceed pooled totals and contradictions in complete additive evidence',()=>{
 const input=value();input.testDurationMs=1000;input.requestCount=0;input.requestsPerSecond=0;
 input.endpoints[0]!.requestCount=100;input.endpoints[0]!.requestsPerSecond=100;
 expect(runMetricOverviewMatches(input,key)).toBe(false);
 const latency=value();latency.endpoints[0]!.latency!.count=2;
 latency.endpoints[0]!.latency!.mean=latency.endpoints[0]!.latency!.sum/2;
 expect(runMetricOverviewMatches(latency,key)).toBe(false);
 const missing=value();missing.source!.numericVersion=4;missing.requestCount=100;missing.testDurationMs=1000;missing.requestsPerSecond=100;
 expect(runMetricOverviewMatches(missing,key)).toBe(true); // A missing endpoint counter does not become zero.
});
