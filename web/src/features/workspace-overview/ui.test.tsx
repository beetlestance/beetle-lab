// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import type {WorkspaceOverview as Snapshot} from '@beetle/contracts/api';
import {ApiContext} from '../../app/api.js';
import {createQueryClient} from '../../app/queries.js';
import {testClient,json,deferred,apiError} from '../../app/test-fixtures.js';
import {WorkspaceOverview} from './index.js';
import valid from '../../../../contracts/fixtures/api/valid/workspace-overview.json';
const snapshot=():Snapshot=>structuredClone(valid) as Snapshot;
const scope=valid.scope;
afterEach(cleanup);
function mount(f:ReturnType<typeof testClient>){
 const client=createQueryClient();
 const element=(organizationId=scope.organizationId)=><MemoryRouter><ApiContext.Provider value={f.client}><QueryClientProvider client={client}>
  <WorkspaceOverview organizationId={organizationId} workspaceId={scope.workspaceId} />
 </QueryClientProvider></ApiContext.Provider></MemoryRouter>;
 const view=render(element());return {...view,change:(org:string)=>view.rerender(element(org))};
}
it('shows known empty snapshots and refresh errors as unknown with one request per explicit read',async()=>{
 let fail=false;const f=testClient(()=>fail?json(apiError('storage_unavailable'),503):json(snapshot()));mount(f);
 await screen.findByText('No runs submitted in this workspace yet.');expect(f.records).toHaveLength(1);
 expect(screen.getByText(/active records do not prove engine liveness/)).toBeInTheDocument();
 fireEvent.click(screen.getByText('Hourly submission activity (24 hours)'));expect(screen.getAllByRole('row')).toHaveLength(25);expect(f.records).toHaveLength(1);
 fail=true;fireEvent.click(screen.getByRole('button',{name:'Refresh overview'}));
 await screen.findByRole('alert');expect(screen.queryByText('All run records')).not.toBeInTheDocument();expect(f.records).toHaveLength(2);
 fail=false;fireEvent.click(screen.getByRole('button',{name:'Refresh overview'}));await screen.findByText('All run records');expect(f.records).toHaveLength(3);
});
it('fences late old-scope snapshots and rejects a foreign reply',async()=>{
 const held=deferred<Response>();const foreign='00000000-0000-4000-8000-000000000099';
 const f=testClient(request=>request.path.includes(foreign)?json(snapshot()):held.promise);const view=mount(f);
 await waitFor(()=>expect(f.records).toHaveLength(1));expect(screen.getByRole('status')).toBeInTheDocument();view.change(foreign);
 await screen.findByRole('alert');await act(async()=>{held.resolve(json(snapshot()));});
 expect(screen.queryByText('All run records')).not.toBeInTheDocument();expect(f.records).toHaveLength(2);
});
it('navigates recent and active summaries inside the validated workspace without fetching details',async()=>{
 const value=snapshot();const id='00000000-0000-4000-8000-000000000050';
 const row={id,suiteId:id,revisionId:id,requestedAt:value.windowStart,state:'active' as const,outcome:'pending' as const};
 value.counts={...value.counts,runs:1,active:1,submitted24h:1};value.activity[0]!.count=1;value.recent=[row];value.active=[row];
 const f=testClient(()=>json(value));mount(f);await screen.findByText('All run records');
 const links=screen.getAllByRole('link',{name:id});expect(links).toHaveLength(2);
 for(const link of links)expect(link).toHaveAttribute('href',`/organizations/${scope.organizationId}/workspaces/${scope.workspaceId}/runs/${id}`);
 expect(f.records).toHaveLength(1);expect(f.records[0]!.method).toBe('GET');
});
