// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ComparisonHeadline, p95Change } from './Headline.js';
import { snapshot } from './fixtures.js';
import type { RunMetricOverview } from '@beetle/contracts/api';
import overview from '../../../../../contracts/fixtures/api/valid/run-metric-overview.json' with {type:'json'};
afterEach(cleanup);
it('describes direction, equality and small changes without rounding them to equality',()=>{
 expect(p95Change(188,197)).toContain('5% higher');
 expect(p95Change(197,188)).toContain('5% lower');
 expect(p95Change(1000,1001)).toContain('less than 1% higher');
 expect(p95Change(1001,1000)).toContain('less than 1% lower');
 expect(p95Change(0,0)).toContain('unchanged');
});
it('keeps absent, zero-baseline and overflowing percentages unavailable',()=>{
 expect(p95Change(null,197)).toContain('unavailable');
 expect(p95Change(0,197)).toContain('baseline is zero');
 expect(p95Change(Number.MIN_VALUE,Number.MAX_VALUE)).toContain('unavailable');
});
it('uses ready overview nulls rather than substituting native threshold readings',()=>{
 const items=snapshot().items;
 items[1]!.result!.firstFailedSlo={id:'native-tail',reading:{source:'native-summary',metric:'http_req_duration',stat:'p95',value:197},limit:{metric:'http_req_duration',stat:'p95',operator:'<',value:250}};
 const overviews=new Map(items.map(item=>[item.run.id.toLowerCase(),{status:'loaded' as const,value:{...overview,id:item.run.id,scope:item.run.scope,attemptId:item.run.activeAttemptId,latency:null} as RunMetricOverview}]));
 render(<ComparisonHeadline items={items} summaries={undefined} overviews={overviews}/>);
 expect(screen.getByText(/Recorded p95 comparison unavailable/)).toBeInTheDocument();
 expect(screen.queryByText(/197/)).not.toBeInTheDocument();
});
