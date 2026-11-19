import historySource from '../../../../../contracts/fixtures/api/valid/run-chart-history.json' with { type: 'json' };
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { RunMetricOverview, RunChartHistory } from '@beetle/contracts/api';
import source from '../../../../../contracts/fixtures/api/valid/run-metric-overview.json' with { type: 'json' };
import { SummaryTiles } from './Sections.js';
import { pendingRunHistorySummary } from '@beetle/contracts/api';
import { run } from '../test-fixtures.js';
import { MetricSummary, ResultEndpoints } from './Overview.js';
afterEach(cleanup);
const overview=()=>structuredClone(source) as RunMetricOverview;
it('renders five pooled tiles, keeping missing measurements unknown and zero dropped iterations visible',()=>{
 const value=overview();value.droppedIterations=0;value.checks={passed:3,total:4,ratio:0.75};
 render(<MetricSummary overview={value} />);
 expect(screen.getByText('0')).toBeVisible();expect(screen.getByText('75%')).toBeVisible();
 expect(screen.getByText('a second on average').parentElement).toHaveTextContent('–');
 expect(screen.getByText(/p95, p50/)).toBeVisible();expect(document.querySelectorAll('.result-overview-tiles dd')).toHaveLength(5);
});
it('filters real endpoint names while retaining unknown source labels and sorting p95 highest first',()=>{
 const value=overview();const first=value.endpoints[0]!;
 value.endpoints=[{...first,request:'r0',latency:null},{...first,request:'r1'},{...first,request:'r2',latency:null}];
 render(<ResultEndpoints overview={value} requests={[{label:'r0',name:'checkout',method:'POST',path:'/checkout'}]} />);
 const table=screen.getByRole('table',{name:'Whole-run endpoint measurements'});
 const rows=within(table).getAllByRole('row');expect(rows[1]).toHaveTextContent('r1');expect(rows[2]).toHaveTextContent('POST /checkout');
 fireEvent.change(screen.getByRole('searchbox',{name:'Filter endpoints'}),{target:{value:'CHECKOUT'}});
 expect(within(table).getAllByRole('row')).toHaveLength(2);expect(within(table).getByText('POST /checkout')).toBeVisible();
 fireEvent.change(screen.getByRole('searchbox',{name:'Filter endpoints'}),{target:{value:'absent'}});
 expect(screen.getByText('No endpoints match this filter.')).toBeVisible();
});
it('states endpoint omissions and never converts a missing or zero denominator into a fabricated share',()=>{
 const value=overview();value.requestCount=0;value.omittedEndpoints=2;
 render(<ResultEndpoints overview={value} requests={[]} />);
 expect(screen.getByText(/2 additional endpoint rows are omitted/)).toBeVisible();
 const row=within(screen.getByRole('table')).getAllByRole('row')[1]!;
 expect(within(row).getAllByRole('cell')[0]).toHaveTextContent('–');
});

it('uses an observed peak only from the same sealed numeric original',()=>{
 const value=overview();const history=structuredClone(historySource) as RunChartHistory;value.source=history.source;
 const view=render(<MetricSummary overview={value} history={history} />);
 expect(screen.getByText('a second on average, observed peak 9')).toBeVisible();
 const wrong={...history,source:{...history.source!,numericSha256:'f'.repeat(64)}};
 view.rerender(<MetricSummary overview={value} history={wrong} />);
 expect(screen.getByText('a second on average')).toBeVisible();expect(screen.getByText(/Observed peak is unavailable/)).toBeVisible();
});

it('keeps the same endpoint facts and active filter when phone columns move p95 and failed first', () => {
 const value=overview();const endpoint=value.endpoints[0]!;
 const requests=[{label:endpoint.request,name:'checkout',method:'POST',path:'/checkout'}];
 const view=render(<ResultEndpoints overview={value} requests={requests} />);
 const headings=()=>within(screen.getByRole('table')).getAllByRole('columnheader').map(cell=>cell.textContent);
 const facts=()=>{
  const row=within(screen.getByRole('table')).getAllByRole('row')[1]!;
  const cells=within(row).getAllByRole('cell').map(cell=>cell.textContent);
  return Object.fromEntries(headings().slice(1).map((label,index)=>[label,cells[index]]));
 };
 expect(headings()).toEqual(['Endpoint','Share','Requests a second','p50','p95 ↓','Failed']);
 const desktopFacts=facts();
 fireEvent.change(screen.getByRole('searchbox',{name:'Filter endpoints'}),{target:{value:'checkout'}});
 view.rerender(<ResultEndpoints overview={value} requests={requests} phone />);
 expect(headings()).toEqual(['Endpoint','p95 ↓','Failed','Share','Requests a second','p50']);
 expect(facts()).toEqual(desktopFacts);
 expect(screen.getByRole('searchbox',{name:'Filter endpoints'})).toHaveValue('checkout');
 expect(screen.getByRole('region',{name:'Endpoint measurements, scroll for more columns'})).toHaveAttribute('tabindex','0');
});

it('uses four phone figures without losing checks, drops or latency detail', () => {
 const value=overview();value.requestsPerSecond=0;value.requestCount=0;value.failure={kind:'rate',numerator:0,sampleCount:2,ratio:0};value.droppedIterations=0;
 render(<MetricSummary overview={value} phone />);
 expect(document.querySelectorAll('.result-phone-tiles dd')).toHaveLength(4);
 expect(screen.getByText('requests in all').parentElement).toHaveTextContent('0');
 expect(screen.getByText('a second on average').parentElement).toHaveTextContent('0');
 expect(screen.getByText('of requests failed').parentElement).toHaveTextContent('0%');
 expect(screen.getByText('Checks passed')).not.toBeVisible();
 fireEvent.click(screen.getByText('More whole-run measurements'));
 const details=screen.getByText('More whole-run measurements').closest('details')!;
 details.open=true;fireEvent(details,new Event('toggle'));
 expect(screen.getByText('Iterations dropped').parentElement).toHaveTextContent('0');
 expect(screen.getByText('p50 latency, estimate')).toBeVisible();
});
it('keeps unknown phone values explicit and partial coverage visible outside closed details', () => {
 const value=overview();value.requestsPerSecond=null;value.requestCount=null;value.latency=null;value.failure=null;
 value.source={...value.source!,coverage:{complete:false,latePoints:1,markerDelayDroppedBuckets:0}};
 render(<MetricSummary overview={value} phone />);
 const primary=document.querySelector('.result-phone-tiles')!;
 expect(within(primary as HTMLElement).getAllByTitle('Not recorded')).toHaveLength(4);
 expect(screen.getByText('Source-window coverage is partial.')).toBeVisible();
});

it('keeps four explicit unknown figures when only pending history is available on phone', () => {
 render(<SummaryTiles summary={pendingRunHistorySummary(run())} status="ready" phone />);
 const primary=document.querySelector('.result-phone-tiles')!;
 expect(within(primary as HTMLElement).getAllByTitle('Not recorded')).toHaveLength(4);
 expect(screen.getByText('Saved history figures: index pending.')).toBeVisible();
});
