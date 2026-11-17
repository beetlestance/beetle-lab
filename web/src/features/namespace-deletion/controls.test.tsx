// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {apiError,json,mount,readNamespace,testClient,org,ids,workspace} from '../../app/test-fixtures.js';
import {routes} from '../../app/routes.js';
import {settings,workspaceScope} from '../settings/test-fixtures.js';
afterEach(cleanup);

it('retires a workspace from its settings with the read version and returns to the organization',async()=>{
 const api=testClient(request=>{
  if(request.method==='GET')return request.path.endsWith('/settings')?json(settings(workspaceScope)):readNamespace(request);
  return json({id:workspace().id,scope:workspace().scope,version:2,state:'tombstoned',cleanup:'complete',requestId:request.body!.requestId});
 });
 mount(api.client,routes.workspaceSettings(ids.a,ids.workspace));
 expect(await screen.findByRole('heading',{name:'Retire Same workspace'})).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Retire workspace…'}));
 fireEvent.change(screen.getByLabelText('Type Same workspace to confirm'),{target:{value:'Same workspace'}});
 fireEvent.click(screen.getByRole('button',{name:'Retire workspace'}));
 await screen.findByRole('link',{name:'Organization settings'});
 const request=api.records.find(x=>x.method==='DELETE');
 expect(request?.path).toBe(`/api/v2/organizations/${ids.a}/workspaces/${ids.workspace}`);
 expect(request?.body).toMatchObject({scope:workspace().scope,expectedVersion:workspace().version});
});
it('confirms empty-only deletion and retries an unknown outcome with the identical versioned request',async()=>{
 let writes=0;
 const api=testClient(request=>{
  if(request.method==='GET')return readNamespace(request);
  writes++;if(writes===1)return json(apiError('storage_unavailable'),503);
  return json({id:org().id,scope:org().scope,version:2,state:'tombstoned',cleanup:'complete',requestId:request.body!.requestId});
 });
 mount(api.client);
 const buttons=await screen.findAllByRole('button',{name:'Delete Same organization'});fireEvent.click(buttons[0]!);
 const dialog=screen.getByRole('alertdialog',{name:'Retire Same organization?'});
 expect(within(dialog).getByText(/Retire its workspaces first/)).toBeVisible();
 const confirm=within(dialog).getByRole('button',{name:'Retire organization'});expect(confirm).toBeDisabled();
 fireEvent.change(within(dialog).getByLabelText('Type Same organization to confirm'),{target:{value:'Same org'}});expect(confirm).toBeDisabled();
 fireEvent.change(within(dialog).getByLabelText('Type Same organization to confirm'),{target:{value:'Same organization'}});
 fireEvent.click(confirm);
 expect(await within(dialog).findByText('Beetle did not confirm this.')).toBeVisible();
 fireEvent.click(within(dialog).getByRole('button',{name:'Retry identical request'}));
 await waitFor(()=>expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
 const requests=api.records.filter(x=>x.method==='DELETE');expect(requests).toHaveLength(2);
 expect(requests[1]!.body).toEqual(requests[0]!.body);expect(requests[0]!.body).toMatchObject({scope:{kind:'installation'},expectedVersion:1});
});

it('explains retained workspace contents, removes the acknowledged list entry and refreshes organisation counts',async()=>{
 let deleted=false;let overviewReads=0;
 const api=testClient(request=>{
  if(request.method==='GET'){
   if(request.path.endsWith('/overview')){overviewReads++;return json(apiError('storage_unavailable'),503);}
   if(request.path.includes('/workspaces?')&&deleted)return json({scope:workspace().scope,items:[],nextCursor:null});
   return readNamespace(request);
  }
  deleted=true;return json({id:workspace().id,scope:workspace().scope,version:4,state:'tombstoned',cleanup:'complete',requestId:request.body!.requestId});
 });
 mount(api.client,`/organizations/${ids.a}`);
 fireEvent.click(await screen.findByRole('button',{name:'Delete Same workspace'}));
 expect(screen.getByText(/their storage is not freed/)).toBeVisible();
 fireEvent.change(screen.getByLabelText('Type Same workspace to confirm'),{target:{value:'Same workspace'}});
 fireEvent.click(screen.getByRole('button',{name:'Retire workspace'}));
 await waitFor(()=>expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
 expect(screen.queryByRole('link',{name:'Same workspace'})).not.toBeInTheDocument();expect(overviewReads).toBeGreaterThanOrEqual(2);
});

it('shows a refusal as returned and keeps the confirmation open without replay',async()=>{
 const api=testClient(request=>request.method==='GET'?readNamespace(request):json(apiError('conflict'),409));
 mount(api.client,`/organizations/${ids.a}`);
 fireEvent.click(await screen.findByRole('button',{name:'Delete Same workspace'}));
 fireEvent.change(screen.getByLabelText('Type Same workspace to confirm'),{target:{value:'Same workspace'}});
 fireEvent.click(screen.getByRole('button',{name:'Retire workspace'}));
 expect(await screen.findByText('Version or intent conflict')).toBeVisible();
 expect(screen.getByText('Retire was refused.')).toBeVisible();
 expect(screen.queryByRole('button',{name:'Retry identical request'})).not.toBeInTheDocument();
 expect(api.records.filter(x=>x.method==='DELETE')).toHaveLength(1);
});
