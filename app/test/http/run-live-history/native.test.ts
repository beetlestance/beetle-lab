import {expect,it,vi} from 'vitest';
import {captureLiveMetricHistory} from '@beetle/contracts/api';
import type {RunLiveHistoryService} from '../../../src/ports/run-live-history.js';
import type {RunMetricsService} from '../../../src/ports/run-metrics.js';
import data from '../../../../contracts/fixtures/api/valid/live-target-history.json' with {type:'json'};
import {hash} from '../../run-live-metrics/fixtures.js';
import {httpFixture} from '../run-metrics/fixture.js';
const unused=async()=>{throw Error('Unexpected synthetic sealed-history read')};
const history:RunMetricsService={readRunHistorySummary:unused,lookupRunMetricSeries:unused,reader:{listRunMetricSeries:unused,getRunMetricSamples:unused,getRunLatencyAttribution:unused},close:async()=>{}};
it('serves the public descriptor through real session protection and generated client ownership',async()=>{
 const value=captureLiveMetricHistory(data,hash);const getRunLiveHistory=vi.fn<RunLiveHistoryService['reader']['getRunLiveHistory']>(async()=>value);const service={reader:{getRunLiveHistory},close:async()=>{}};
 const http=await httpFixture(history,undefined,service);const params={organizationId:value.scope.organizationId,workspaceId:value.scope.workspaceId,attemptId:value.scope.attemptId,runId:'00000000-0000-4000-8000-000000000099'};
 try{
  expect(await http.client.getRunLiveHistory({params})).toEqual({ok:true,value});expect(getRunLiveHistory).toHaveBeenCalledTimes(1);
  const url=`${http.origin}/api/v2/organizations/${params.organizationId}/workspaces/${params.workspaceId}/runs/${params.runId}/attempts/${params.attemptId}/metrics/live-history`;
  expect((await fetch(url)).status).toBe(401);expect((await fetch(url+'?path=secret',{headers:http.headers})).status).toBe(400);expect(getRunLiveHistory).toHaveBeenCalledTimes(1);
  const wrong=structuredClone(value);wrong.prefix.scope.generation=2;getRunLiveHistory.mockResolvedValue(wrong);expect(await http.client.getRunLiveHistory({params})).toMatchObject({ok:false,error:{kind:'response'}});
 }finally{await http.close();}
});
