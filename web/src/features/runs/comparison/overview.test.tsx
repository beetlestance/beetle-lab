// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import overviewData from '../../../../../contracts/fixtures/api/valid/run-metric-overview.json' with {type:'json'};
import { afterEach, expect, it } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { validateApi } from '@beetle/contracts/api';
import type { ApiClient, Run } from '@beetle/contracts/api';
import { historyPage } from '../test-fixtures.js';
import { catalogue, deferred, json, mountComparison, snapshot, testClient } from './fixtures.js';
import { comparisonFigures } from './figures.js';
import { delta } from './Deltas.js';
afterEach(cleanup);
function overview(run: Run) {
 const checked=validateApi('RunMetricOverview',{...overviewData,id:run.id,scope:run.scope,attemptId:run.activeAttemptId,checks:{passed:3,total:4,ratio:0.75},droppedIterations:0});
 if(!checked.ok)throw Error('Invalid scoped overview fixture: '+JSON.stringify(checked));return checked.value;
}
function fixture() {
 const items=snapshot().items;
 return testClient(request=>{
  if(request.path.endsWith('/comparisons'))return json(snapshot());
  const run=items.find(item=>request.path.includes(item.run.id))?.run;
  if(run&&request.path.endsWith('/metrics/overview'))return json(overview(run));
  if(request.path.includes('/runs?')){
   const id=new URL(request.path,'http://localhost').searchParams.get('runIdPrefix');
   return json(historyPage(items.filter(item=>item.run.id===id).map(item=>item.run),items[0]!.run.scope));
  }
  return json(catalogue());
 });
}
it('adds p50/p99, invocation check ratio and dropped counts through one overview per run',async()=>{
 const f=fixture();mountComparison(f.client);const table=await screen.findByRole('table',{name:/difference from the baseline/});
 for(const label of ['p50, histogram estimate','p99, histogram estimate','Checks passed','Dropped iterations']) {
  const row=within(table).getByRole('rowheader',{name:label}).closest('tr')!;expect(within(row).queryByLabelText('Unknown')).not.toBeInTheDocument();
 }
 expect(f.records.filter(record=>record.path.endsWith('/metrics/overview'))).toHaveLength(2);
 expect(f.records.filter(record=>record.path.includes('/samples?'))).toHaveLength(0);
});
it('keeps ready overview unknown fields unknown and guards delta overflow',()=>{
 const run=snapshot().items[0]!.run;const value=overview(run);const figures=comparisonFigures(undefined,{status:'loaded',value});
 expect(figures?.checksRatio).toBe(value.checks?.ratio??null);expect(figures?.p99).toBe(value.latency?.percentiles.p99.estimate??null);
 const empty={...value,latency:null,checks:null};expect(comparisonFigures(undefined,{status:'loaded',value:empty})?.p95).toBeNull();
 expect(delta('relative',Number.MIN_VALUE,Number.MAX_VALUE)).toBeNull();expect(delta('absolute',0,3)).toBe('+3');expect(delta('absolute',0,0)).toBe('same');
});
it('holds admission behind a retired overview original until it settles, without continuing old peer reads',async()=>{
 const held=deferred<Awaited<ReturnType<ApiClient['getRunMetricOverview']>>>();let signal:AbortSignal|undefined;let calls=0;
 const first=fixture();const client={...first.client,getRunMetricOverview:(input:Parameters<ApiClient['getRunMetricOverview']>[0])=>{calls++;signal=input.signal;return held.promise;}};
 const view=mountComparison(client);await waitFor(()=>expect(calls).toBe(1));view.unmount();expect(signal!.aborted).toBe(true);
 const next=fixture();mountComparison(next.client);await act(async()=>{await Promise.resolve()});expect(next.records).toHaveLength(0);
 await act(async()=>held.resolve({ok:true,value:overview(snapshot().items[0]!.run)}));
 await screen.findByLabelText('Baseline metric');expect(calls).toBe(1);expect(next.records.filter(record=>record.path.endsWith('/metrics/overview'))).toHaveLength(2);
});
