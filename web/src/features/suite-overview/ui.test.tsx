// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import {QueryClientProvider} from '@tanstack/react-query';
import type {Suite} from '@beetle/contracts/api';
import {ApiContext} from '../../app/api.js';
import {createQueryClient} from '../../app/queries.js';
import {testClient,json,apiError,deferred} from '../../app/test-fixtures.js';
import {run,historyPage} from '../runs/test-fixtures.js';
import {RunHistory} from '../runs/RunHistory.js';
import {RecentRuns} from './index.js';
const source=run();const suite:Suite={id:source.suiteId,scope:source.scope,version:1,name:'Suite',folderId:source.id,currentRevisionId:source.revisionId};
const ordinals=new Map([[source.revisionId.toLowerCase(),4]]);
afterEach(cleanup);
function mount(api:ReturnType<typeof testClient>,latest=true,url='/'){
 const client=createQueryClient();const element=(value=suite)=><MemoryRouter initialEntries={[url]}><ApiContext.Provider value={api.client}><QueryClientProvider client={client}>
  {latest?<RecentRuns suite={value} ordinals={ordinals}/>:<RunHistory organizationId={suite.scope.organizationId} workspaceId={suite.scope.workspaceId}/>}
 </QueryClientProvider></ApiContext.Provider></MemoryRouter>;
 const view=render(element());return{change:(value:Suite)=>view.rerender(element(value))};
}
it('reads five suite-filtered rows, labels the revision ordinal, links history and hides rows after a failed retry',async()=>{
 let fail=false;const api=testClient(()=>fail?json(apiError('storage_unavailable'),503):json(historyPage([source])));mount(api);
 const link=await screen.findByRole('link',{name:`Queued run ${source.id}`});
 expect(link).toHaveAttribute('href',expect.stringContaining(source.id));expect(link).toHaveTextContent('rev 4,');
 expect(api.records).toHaveLength(1);const query=new URL(api.records[0]!.path,'http://synthetic.invalid').searchParams;
 expect(query.get('suiteId')).toBe(suite.id);expect(query.get('limit')).toBe('5');
 expect(screen.getByRole('link',{name:'All runs of this suite'})).toHaveAttribute('href',expect.stringContaining('suiteId='+suite.id));
 fail=true;cleanup();mount(api);await screen.findByRole('alert');
 fireEvent.click(screen.getByRole('button',{name:'Retry'}));await screen.findByRole('alert');
 expect(screen.queryByRole('link',{name:`Queued run ${source.id}`})).not.toBeInTheDocument();
});
it('omits the rev label when the run revision is not on the loaded revision page',async()=>{
 const other={...source,revisionId:'00000000-0000-4000-8000-000000000042'};
 const api=testClient(()=>json(historyPage([other])));mount(api);
 const link=await screen.findByRole('link',{name:`Queued run ${source.id}`});expect(link).not.toHaveTextContent('rev ');
});
it('fences old-suite replies and keeps the suite context while ordinary filters reset',async()=>{
 const held=deferred<Response>();const api=testClient(()=>held.promise);const view=mount(api);view.change({...suite,id:'00000000-0000-4000-8000-000000000099'});
 await act(async()=>held.resolve(json(historyPage([source]))));await screen.findByRole('alert');expect(screen.queryByRole('link',{name:`Queued run ${source.id}`})).not.toBeInTheDocument();
 cleanup();const scoped=testClient(request=>json(historyPage(request.path.includes('outcome=')?[]:[source])));mount(scoped,false,'/?suiteId='+suite.id);
 const runs=()=>scoped.records.filter(row=>row.path.includes('/runs?'));const row=new RegExp(source.id.slice(0,8));
 await screen.findByRole('link',{name:row});fireEvent.click(screen.getByRole('radio',{name:'Passed'}));
 await screen.findByRole('heading',{name:'No runs match these filters'});
 expect(new URL(runs()[1]!.path,'http://synthetic.invalid').searchParams.get('outcome')).toBe('passed');
 fireEvent.click(screen.getAllByRole('button',{name:'Reset filters'})[0]!);
 await screen.findByRole('link',{name:row});expect(runs()).toHaveLength(3);
 expect(new URL(runs()[2]!.path,'http://synthetic.invalid').searchParams.get('outcome')).toBeNull();
 expect(runs().every(row=>new URL(row.path,'http://synthetic.invalid').searchParams.get('suiteId')===suite.id)).toBe(true);
});
it('rejects ambiguous or malformed suite history URLs before a fetch',()=>{
 const api=testClient(()=>{throw Error('Must not fetch');});mount(api,false,'/?suiteId=bad&suiteId='+suite.id);
 expect(screen.getByRole('alert')).toHaveTextContent('Invalid suite history context');expect(api.records).toEqual([]);
});
