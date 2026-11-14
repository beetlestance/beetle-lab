// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import {QueryClientProvider} from '@tanstack/react-query';
import type {Suite} from '@beetle/contracts/api';
import {ApiContext} from '../../app/api.js';
import {createQueryClient} from '../../app/queries.js';
import {testClient,json,apiError,deferred} from '../../app/test-fixtures.js';
import {run,historyPage} from '../runs/test-fixtures.js';
import {RunHistory} from '../runs/RunHistory.js';
import {SuiteLatestRun} from './index.js';
const source=run();const suite:Suite={id:source.suiteId,scope:source.scope,version:1,name:'Suite',folderId:source.id,currentRevisionId:source.revisionId};
afterEach(cleanup);
function mount(api:ReturnType<typeof testClient>,latest=true,url='/'){
 const client=createQueryClient();const element=(value=suite)=><MemoryRouter initialEntries={[url]}><ApiContext.Provider value={api.client}><QueryClientProvider client={client}>
  {latest?<SuiteLatestRun suite={value}/>:<RunHistory organizationId={suite.scope.organizationId} workspaceId={suite.scope.workspaceId}/>}
 </QueryClientProvider></ApiContext.Provider></MemoryRouter>;
 const view=render(element());return{change:(value:Suite)=>view.rerender(element(value))};
}
it('reads one suite-filtered row, links history and hides cached evidence after refresh failure',async()=>{
 let fail=false;const api=testClient(()=>fail?json(apiError('storage_unavailable'),503):json(historyPage([source])));mount(api);
 expect(await screen.findByRole('link',{name:source.id})).toHaveAttribute('href',expect.stringContaining(source.id));
 expect(api.records).toHaveLength(1);const query=new URL(api.records[0]!.path,'http://synthetic.invalid').searchParams;
 expect(query.get('suiteId')).toBe(suite.id);expect(query.get('limit')).toBe('1');
 expect(screen.getByRole('link',{name:'All history for this suite'})).toHaveAttribute('href',expect.stringContaining('suiteId='+suite.id));
 fail=true;fireEvent.click(screen.getByRole('button',{name:'Refresh latest run'}));await screen.findByRole('alert');expect(screen.queryByRole('link',{name:source.id})).not.toBeInTheDocument();
});
it('fences old-suite replies and keeps the suite context while ordinary filters reset',async()=>{
 const held=deferred<Response>();const api=testClient(()=>held.promise);const view=mount(api);view.change({...suite,id:'00000000-0000-4000-8000-000000000099'});
 await act(async()=>held.resolve(json(historyPage([source]))));await screen.findByRole('alert');expect(screen.queryByRole('link',{name:source.id})).not.toBeInTheDocument();
 cleanup();const scoped=testClient(()=>json(historyPage([])));mount(scoped,false,'/?suiteId='+suite.id);
 await screen.findByText('No runs match this history query.');fireEvent.click(screen.getByRole('button',{name:'Reset filters'}));
 await waitFor(()=>expect(scoped.records).toHaveLength(2));
 expect(scoped.records.every(row=>new URL(row.path,'http://synthetic.invalid').searchParams.get('suiteId')===suite.id)).toBe(true);
});
it('rejects ambiguous or malformed suite history URLs before a fetch',()=>{
 const api=testClient(()=>{throw Error('Must not fetch');});mount(api,false,'/?suiteId=bad&suiteId='+suite.id);
 expect(screen.getByRole('alert')).toHaveTextContent('Invalid suite history context');expect(api.records).toEqual([]);
});
