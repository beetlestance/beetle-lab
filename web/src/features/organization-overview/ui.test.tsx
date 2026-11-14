// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import type {OrganizationOverview as Snapshot} from '@beetle/contracts/api';
import {ApiContext} from '../../app/api.js';
import {createQueryClient} from '../../app/queries.js';
import {testClient,json,deferred,apiError} from '../../app/test-fixtures.js';
import {OrganizationOverview} from './index.js';
import valid from '../../../../contracts/fixtures/api/valid/organization-overview.json';
afterEach(cleanup);
function mount(f:ReturnType<typeof testClient>){
 const client=createQueryClient();const view=(id=valid.scope.organizationId)=><MemoryRouter><ApiContext.Provider value={f.client}><QueryClientProvider client={client}><OrganizationOverview organizationId={id}/></QueryClientProvider></ApiContext.Provider></MemoryRouter>;
 const result=render(view());return{change:(id:string)=>result.rerender(view(id))};
}
it('renders a scoped snapshot and hides cached counts after a failed manual refresh',async()=>{
 let fail=false;const api=testClient(()=>fail?json(apiError('storage_unavailable'),503):json(valid));mount(api);
 await screen.findByText('Workspaces');expect(api.records).toHaveLength(1);
 expect(screen.getByText(/active records do not prove engine liveness/)).toBeVisible();
 fail=true;fireEvent.click(screen.getByRole('button',{name:'Refresh organization overview'}));
 await screen.findByRole('alert');expect(screen.queryByText('All run records')).not.toBeInTheDocument();expect(api.records).toHaveLength(2);
});
it('retires held old-scope data and rejects a foreign snapshot',async()=>{
 const pending=deferred<Response>();const api=testClient(()=>pending.promise);const view=mount(api);
 view.change('00000000-0000-4000-8000-000000000099');await act(async()=>pending.resolve(json(valid)));
 await screen.findByRole('alert');expect(screen.queryByText('All run records')).not.toBeInTheDocument();
});
it('links a recent run through its own workspace instead of the selected workspace',async()=>{
 const snapshot=structuredClone(valid) as Snapshot;const id='00000000-0000-4000-8000-000000000080';const workspaceId='00000000-0000-4000-8000-000000000081';
 snapshot.counts={...snapshot.counts,runs:1,queued:1,submitted24h:1};snapshot.activity[23]!.count=1;
 snapshot.recent=[{id,workspaceId,suiteId:id,revisionId:id,requestedAt:snapshot.activity[23]!.from,state:'queued',outcome:'pending'}];
 mount(testClient(()=>json(snapshot)));expect(await screen.findByRole('link',{name:id})).toHaveAttribute('href',`/organizations/${snapshot.scope.organizationId}/workspaces/${workspaceId}/runs/${id}`);
});
