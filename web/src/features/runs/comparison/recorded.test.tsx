// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import chartData from '../../../../../contracts/fixtures/api/valid/run-chart-history.json' with {type:'json'};
import overviewData from '../../../../../contracts/fixtures/api/valid/run-metric-overview.json' with {type:'json'};
import { afterEach, expect, it } from 'vitest';
import { act, cleanup, screen, waitFor, render, fireEvent } from '@testing-library/react';
import { validateApi } from '@beetle/contracts/api';
import type { ApiClient, Run } from '@beetle/contracts/api';
import { historyPage } from '../test-fixtures.js';
import { catalogue, deferred, json, mountComparison, snapshot, testClient } from './fixtures.js';
import { RecordedComparisonCharts } from './RecordedCharts.js';
import { comparisonPlot } from './overlay-model.js';
import { comparisonPeak } from './recorded-source.js';
afterEach(cleanup);
function history(run:Run,peer=false) {
 const value=structuredClone(chartData);value.id=run.id;value.scope=run.scope;value.attemptId=run.activeAttemptId;
 if(peer){value.source.measurementSourceTimeMs+=59750;value.points.forEach(point=>{point.startTimeMs+=60000;point.endTimeMs+=60000;});}
 const checked=validateApi('RunChartHistory',value);if(!checked.ok)throw Error('Invalid chart fixture');return checked.value;
}
function overview(run:Run,peer=false) {
 const checked=validateApi('RunMetricOverview',{...overviewData,id:run.id,scope:run.scope,attemptId:run.activeAttemptId,source:history(run,peer).source});
 if(!checked.ok)throw Error('Invalid overview fixture');return checked.value;
}
function fixture() {
 const items=snapshot().items;
 return testClient(request=>{
  if(request.path.endsWith('/comparisons'))return json(snapshot());
  const index=items.findIndex(item=>request.path.includes(item.run.id));const run=items[index]?.run;
  if(run&&request.path.endsWith('/metrics/overview'))return json(overview(run,index===1));
  if(run&&request.path.endsWith('/metrics/chart-history'))return json(history(run,index===1));
  if(request.path.includes('/runs?')){const id=new URL(request.path,'http://localhost').searchParams.get('runIdPrefix');return json(historyPage(items.filter(item=>item.run.id===id).map(item=>item.run),items[0]!.run.scope));}
  return json(catalogue());
 });
}
it('retains each recording’s own source positions on one native-marker-relative domain',()=>{
 const items=snapshot().items;const a=history(items[0]!.run),b=history(items[1]!.run,true);
 const plot=comparisonPlot(items,new Map([[items[0]!.run.id,{status:'loaded',value:a}],[items[1]!.run.id,{status:'loaded',value:b}]]));
 expect(plot.curves[0]!.xs).toEqual([1000,2000,3000]);expect(plot.curves[1]!.xs).toEqual([1250,2250,3250]);expect(plot.domain).toEqual([0,3250]);
 expect(plot.curves.every(curve=>curve.p95.length===3)).toBe(true);
});
it('preserves zero, unknowns and source gaps without filling windows',()=>{
 const items=snapshot().items;const value=history(items[0]!.run);
 value.points[0]={...value.points[0]!,requestCount:0,httpSamples:0,httpFailures:0,httpP50:null,httpP95:null,httpP99:null,vus:0};
 value.points[1]={...value.points[1]!,startTimeMs:value.points[1]!.startTimeMs+1000,endTimeMs:value.points[1]!.endTimeMs+1000,gapBefore:true,vus:null};
 value.points[2]={...value.points[2]!,startTimeMs:value.points[2]!.startTimeMs+1000,endTimeMs:value.points[2]!.endTimeMs+1000};
 const curve=comparisonPlot(items,new Map([[items[0]!.run.id,{status:'loaded',value}]])).curves[0]!;
 expect(curve.xs).toEqual([1000,3000,4000]);expect(curve.requests[0]).toBe(0);expect(curve.failures[0]).toBe(0);expect(curve.vus.slice(0,2)).toEqual([0,null]);expect(curve.p95[0]).toBeNull();expect(curve.breaks).toEqual([false,true,false]);
});
it('binds an observed peak to the same numeric generation/version/hash/marker, never configured rate',()=>{
 const run=snapshot().items[0]!.run;const value=history(run);const reading=overview(run);
 expect(comparisonPeak({status:'loaded',value:reading},{status:'loaded',value})).toBe(9);
 for(const patch of [{numericVersion:4},{numericSha256:'f'.repeat(64)},{measurementSourceTimeMs:0}] as const) {
  const other={...value,source:{...value.source!,...patch}};
  expect(comparisonPeak({status:'loaded',value:reading},{status:'loaded',value:other})).toBeNull();
 }
});
it('loads four recorded overlays with one history read per selected run',async()=>{
 const f=fixture();mountComparison(f.client);await waitFor(()=>expect(screen.getAllByRole('img')).toHaveLength(4));
 expect(f.records.filter(record=>record.path.endsWith('/metrics/chart-history'))).toHaveLength(2);
 expect(f.records.filter(record=>record.path.includes('/samples?'))).toHaveLength(0);
 expect(screen.getByRole('rowheader',{name:'Observed peak requests a second'}).closest('tr')).toHaveTextContent('9');
});
it('retains a retired chart original and stops its old peer work before the next owner starts',async()=>{
 const held=deferred<Awaited<ReturnType<ApiClient['getRunChartHistory']>>>();let calls=0;let signal:AbortSignal|undefined;
 const first=fixture();const client={...first.client,getRunChartHistory:(input:Parameters<ApiClient['getRunChartHistory']>[0])=>{calls++;signal=input.signal;return held.promise;}};
 const view=mountComparison(client);await waitFor(()=>expect(calls).toBe(1));view.unmount();expect(signal!.aborted).toBe(true);
 const next=fixture();mountComparison(next.client);await act(async()=>{await Promise.resolve()});expect(next.records).toHaveLength(0);
 await act(async()=>held.resolve({ok:true,value:history(snapshot().items[0]!.run)}));await screen.findByLabelText('Baseline metric');
 expect(calls).toBe(1);expect(first.records.filter(record=>record.path.includes('/runs?'))).toHaveLength(1);
 expect(next.records.filter(record=>record.path.endsWith('/metrics/chart-history'))).toHaveLength(2);
});

it('keeps healthy window provenance inspectable in details without expanding the overview', () => {
 const items=snapshot().items;
 const histories=new Map(items.map(item=>[item.run.id,{status:'loaded' as const,value:history(item.run)}]));
 const overviews=new Map(items.map(item=>[item.run.id,{status:'loaded' as const,value:overview(item.run)}]));
 render(<RecordedComparisonCharts items={items} histories={histories} overviews={overviews}/>);
 for(const note of screen.getAllByText(/plotted of .* verified source windows/))expect(note).not.toBeVisible();
 expect(screen.getAllByRole('img')).toHaveLength(4);
 fireEvent.click(screen.getByText('Recorded source details',{selector:'summary'}));
 for(const note of screen.getAllByText(/plotted of .* verified source windows/))expect(note).toBeVisible();
});
for(const condition of ['partial','downsampled','peak','error'] as const)it(`keeps ${condition} source uncertainty visible without opening details`,()=>{
 const items=snapshot().items;const first=items[0]!.run;const value=history(first);
 if(condition==='partial')value.source!.coverage={...value.source!.coverage,complete:false,latePoints:1};
 if(condition==='downsampled')value.windows+=1;
 const histories=new Map(items.map(item=>[item.run.id,condition==='error'&&item.run.id===first.id
  ? {status:'error' as const} : {status:'loaded' as const,value:item.run.id===first.id?value:history(item.run)}]));
 const overviews=new Map(items.map(item=>[item.run.id,condition==='peak'&&item.run.id===first.id
  ? {status:'error' as const} : {status:'loaded' as const,value:overview(item.run)}]));
 render(<RecordedComparisonCharts items={items} histories={histories} overviews={overviews}/>);
 const text=condition==='partial'?/Window coverage is partial/:condition==='peak'?/Observed peak is unavailable/
  :condition==='error'?/recorded charts could not be loaded/:/3 plotted of 4 verified/;
 expect(screen.getByText(text)).toBeVisible();
});
