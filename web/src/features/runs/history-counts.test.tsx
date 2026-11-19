// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {afterEach,expect,it} from 'vitest';
import {cleanup,screen} from '@testing-library/react';
import {routes} from '../../app/routes.js';
import {queryKeys} from '../../app/queries.js';
import {historyPage,run,mount,testClient,ids,json} from './test-fixtures.js';
import {suiteNames} from './history-fixtures.js';
import {historyRange} from './history-range.js';
afterEach(cleanup);
it('shows exact context chips and current range without deriving either from one page',async()=>{
 const current={...run(),state:'finished' as const,outcome:'passed' as const,validationStatus:'passed' as const};
 // A full single-page response must actually contain every matched item.
 const rows=Array.from({length:5},(_,i)=>({...current,id:'00000000-0000-4000-8000-'+String(20-i).padStart(12,'0'),state:i===1?'active' as const:i===2?'cancelled' as const:'finished' as const,outcome:i===1?'pending' as const:i===2?'inconclusive' as const:i===3?'failed' as const:'passed' as const,cancellationRequested:i===2,reason:i===2?'cancelled' as const:null,pinned:i===4,...(i===4?{pinnedAt:'2026-11-09T00:00:00.000Z'}:{})}));
 const counted=testClient(request=>suiteNames(request.path)??json({...historyPage(rows),workspaceName:'Counted workspace',counts:{all:5,running:1,passed:2,failed:1,cancelled:1,pinned:1,matched:5,before:0}}));
 mount(counted.client,routes.runs(ids.a,ids.workspace));
 const all=await screen.findByRole('radio',{name:'All 5'});expect(all).toBeChecked();
 expect(screen.getByRole('radio',{name:'Running 1'})).toBeVisible();expect(screen.getByRole('radio',{name:'Pinned 1'})).toBeVisible();
 expect(screen.getByRole('navigation',{name:'Run pages'})).toHaveTextContent('Showing 1 to 5 of 5');
 expect(screen.getByText(/^5 runs\./)).toBeInTheDocument();
 expect(counted.records.filter(r=>r.path.includes('/runs?'))).toHaveLength(1);
 expect(counted.records.find(r=>r.path.includes('/runs?'))!.path).toContain('includeCounts=true');
});
it('keeps absent counts unknown and separates enriched cache entries',async()=>{
 const f=testClient(request=>suiteNames(request.path)??json(historyPage([run()])));mount(f.client,routes.runs(ids.a,ids.workspace));
 await screen.findByRole('table');expect(screen.getByRole('radio',{name:'All'})).toBeChecked();
 expect(screen.queryByText(/Showing .* of/)).not.toBeInTheDocument();
 expect(queryKeys.runsPage(ids.a,ids.workspace)).not.toEqual(queryKeys.runsPage(ids.a,ids.workspace,'',{limit:100,includeCounts:true}));
 const page=historyPage([]);page.counts={all:5,running:0,passed:0,failed:0,cancelled:0,pinned:0,matched:5,before:5};
 expect(historyRange(page)).toBe('No runs on this page · 5 matching runs');
});
