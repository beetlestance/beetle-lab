import historySource from '../../../../../contracts/fixtures/api/valid/run-chart-history.json' with { type: 'json' };
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { RunMetricOverview, RunChartHistory } from '@beetle/contracts/api';
import source from '../../../../../contracts/fixtures/api/valid/run-metric-overview.json' with { type: 'json' };
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
