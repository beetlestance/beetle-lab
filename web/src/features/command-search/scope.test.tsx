// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {read,ids,json,testClient,mount,deferred,suite,workspace,apiError} from './fixtures.js';
import {routes} from '../../app/routes.js';
afterEach(cleanup);
async function open(){fireEvent.click(screen.getByRole('button',{name:'Search commands'}));return await screen.findByRole('dialog');}
it('shares the exact pending list original and preserves the remaining observer after search closes',async()=>{
 const held=deferred<Response>();const f=testClient(request=>request.path.includes('/workspaces?')?held.promise:read(request));mount(f.client,routes.organization(ids.a));
 await screen.findByRole('heading',{name:'Workspaces'});const dialog=await open();expect(f.records.filter(row=>row.path.includes('/workspaces?'))).toHaveLength(1);
 const original=f.records.find(row=>row.path.includes('/workspaces?'))!;fireEvent.keyDown(within(dialog).getByRole('searchbox'),{key:'Escape'});
 expect(original.signal?.aborted).toBe(false);await act(async()=>held.resolve(json({scope:{kind:'organization',organizationId:ids.a},items:[workspace()],nextCursor:null})));
 expect(await screen.findByRole('link',{name:'Same workspace'})).toHaveAttribute('href',routes.workspace(ids.a,ids.workspace));expect(f.records.every(row=>row.method==='GET')).toBe(true);
});
it('rejects wrong-owner pages, keeps navigation available and retries only on explicit request',async()=>{
 let fixed=false;const f=testClient(request=>request.path.includes('/workspaces?')&&!fixed?json({scope:{kind:'organization',organizationId:ids.b},items:[{...workspace(ids.b),name:'Foreign workspace'}],nextCursor:null}):read(request));
 mount(f.client,routes.organization(ids.a));await screen.findByRole('alert');const before=f.records.filter(row=>row.path.includes('/workspaces?')).length;const dialog=await open();
 expect(await within(dialog).findByText('Recent workspaces could not be loaded.')).toBeVisible();expect(within(dialog).queryByText('Foreign workspace')).not.toBeInTheDocument();
 expect(f.records.filter(row=>row.path.includes('/workspaces?'))).toHaveLength(before);fixed=true;fireEvent.click(within(dialog).getByRole('button',{name:'Retry recent workspaces'}));
 expect(await within(dialog).findByRole('link',{name:/Same workspace/})).toHaveAttribute('href',routes.workspace(ids.a,ids.workspace));
});
it('retires immediately on scope switch and never adopts a late old-scope same-name item',async()=>{
 const held=deferred<Response>();const f=testClient(request=>request.path.includes(ids.a)&&request.path.includes('/suites?')?held.promise:read(request));
 mount(f.client,routes.workspace(ids.a,ids.workspace));await screen.findByRole('heading',{name:'Folders'});const first=await open();await within(first).findByText('Loading suites…');
 fireEvent.click(screen.getByRole('button',{name:'Switch workspace B'}));await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 await screen.findByRole('heading',{name:'Folders'});const second=await open();const link=await within(second).findByRole('link',{name:/Shared suite/});
 expect(link).toHaveAttribute('href',routes.suite(ids.b,ids.workspace,suite().id));
 await act(async()=>held.resolve(json({scope:suite().scope,items:[suite()],nextCursor:null})));
 expect(within(second).getByRole('link',{name:/Shared suite/})).toHaveAttribute('href',routes.suite(ids.b,ids.workspace,suite().id));expect(f.records.every(row=>row.method==='GET')).toBe(true);
});
it('shows more-page and unavailable groups without turning failed reads into empty success',async()=>{
 const f=testClient(request=>request.path.includes('/suites?')?json({scope:suite().scope,items:[suite()],nextCursor:'more_suites'}):request.path.includes('/runs?')?json(apiError('storage_unavailable'),503):read(request));
 mount(f.client,routes.workspace(ids.a,ids.workspace));await screen.findByRole('heading',{name:'Folders'});const dialog=await open();
 expect(await within(dialog).findByText('More suites are available in the list view.')).toBeVisible();expect(await within(dialog).findByText('Recent runs could not be loaded.')).toBeVisible();
 const reads=f.records.length;fireEvent.change(within(dialog).getByRole('searchbox'),{target:{value:'Shared'}});await waitFor(()=>expect(within(dialog).getAllByRole('link')).toHaveLength(1));expect(f.records).toHaveLength(reads);
});
it('shares only the identical unfiltered history first page with command search', async () => {
 const held=deferred<Response>();const f=testClient(request=>request.path.includes('/runs?')?held.promise:read(request));
 mount(f.client,routes.runs(ids.a,ids.workspace));await screen.findByRole('heading',{name:'Runs'});const dialog=await open();
 expect(f.records.filter(row=>row.path.includes('/runs?'))).toHaveLength(1);
 const original=f.records.find(row=>row.path.includes('/runs?'))!;expect(original.path).toContain('limit=100&order=newest');
 fireEvent.keyDown(within(dialog).getByRole('searchbox'),{key:'Escape'});expect(original.signal?.aborted).toBe(false);
 await act(async()=>held.resolve(json({scope:{kind:'workspace',organizationId:ids.a,workspaceId:ids.workspace},items:[],nextCursor:null})));
 await screen.findByText('No runs match this history query.');
});
