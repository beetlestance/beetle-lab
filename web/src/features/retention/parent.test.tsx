// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach,expect,it } from 'vitest';
import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { RetentionTraversalPage } from '@beetle/contracts/api';
import { ApiContext } from '../../app/api.js';
import { testClient,json,ids,mount } from '../../app/test-fixtures.js';
import { routes } from '../../app/routes.js';
import { ParentRetentionControls } from './Parent.js';
import { preview,scope,fixture,id } from './test-fixtures.js';
afterEach(cleanup);
function page(body:Record<string,unknown>):RetentionTraversalPage{
 const workspace=preview(body);return{scope:body.scope as RetentionTraversalPage['scope'],requestId:body.requestId as string,settingsId:body.settingsId as string,settingsVersion:body.expectedVersion as number,capturedAt:workspace.capturedAt,
  coverage:'live_partial',durable:true,workspace,nextCursor:(body.page as {cursor?:string}).cursor?null:btoa(workspace.snapshotId)};
}
function mountParent(api:ReturnType<typeof testClient>['client'],version=2){
 const owner={kind:'installation' as const};const element=(next:number)=><ApiContext.Provider value={api}><MemoryRouter><ParentRetentionControls scope={owner} settingsId={ids.request} version={next}/></MemoryRouter></ApiContext.Provider>;
 const view=render(element(version));return{...view,version:(next:number)=>view.rerender(element(next))};
}
it('opens explicitly, labels live partial coverage and links to the exact workspace batch without a parent Apply',async()=>{
 const f=testClient(request=>json(page(request.body!)));mountParent(f.client);expect(f.records).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'Manage workspace retention'}));expect(f.records).toHaveLength(0);fireEvent.click(screen.getByRole('button',{name:'Preview workspaces'}));
 const link=await screen.findByRole('link',{name:'Open batch in workspace'});expect(link).toHaveAttribute('href',routes.workspaceSettings(scope.organizationId,scope.workspaceId)+'?retentionBatch='+id);
 expect(screen.getByText(/Coverage: live \/ partial/)).toBeInTheDocument();expect(screen.queryByRole('button',{name:/Apply deletion/})).not.toBeInTheDocument();expect(f.records).toHaveLength(1);expect(f.records[0]!.path).toBe('/api/v2/settings/retention-preview');
});
it('continues the stored cursor and original settings pin despite a background settings update',async()=>{
 const f=testClient(request=>json(page(request.body!)));const view=mountParent(f.client);fireEvent.click(screen.getByRole('button',{name:'Manage workspace retention'}));fireEvent.click(screen.getByRole('button',{name:'Preview workspaces'}));
 await screen.findByRole('button',{name:'Preview next workspace window'});view.version(3);fireEvent.click(screen.getByRole('button',{name:'Preview next workspace window'}));
 await screen.findByText('The scan reached its horizon. This does not establish complete coverage.');expect(f.records[1]!.body).toMatchObject({expectedVersion:2,page:{limit:100,cursor:btoa(id)}});expect(f.records[1]!.body?.requestId).not.toBe(f.records[0]!.body?.requestId);
});
it('retains identical parent preview intent after an unknown reply',async()=>{
 let calls=0;const f=testClient(request=>{if(++calls===1)throw Error('Synthetic lost parent response');return json(page(request.body!));});mountParent(f.client);fireEvent.click(screen.getByRole('button',{name:'Manage workspace retention'}));fireEvent.click(screen.getByRole('button',{name:'Preview workspaces'}));
 await screen.findByText(/Outcome unknown/);expect(screen.getByRole('button',{name:'Preview workspaces'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Retry identical traversal request'}));
 await screen.findByRole('link',{name:'Open batch in workspace'});expect(f.records).toHaveLength(2);expect(f.records[1]!.body).toEqual(f.records[0]!.body);
});
it('does not present a non-durable empty result as stored work or completion',async()=>{
 const f=testClient(request=>json({...page(request.body!),workspace:null,durable:false,nextCursor:null}));mountParent(f.client);fireEvent.click(screen.getByRole('button',{name:'Manage workspace retention'}));fireEvent.click(screen.getByRole('button',{name:'Preview workspaces'}));
 await screen.findByText('No workspace remains in this scan. This empty result is not stored and has no replay guarantee.');expect(screen.queryByRole('link',{name:'Open batch in workspace'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Preview next workspace window'})).not.toBeInTheDocument();
});
it('opens a linked workspace batch from durable reads without creating another preview or Apply',async()=>{
 const f=fixture();f.storePreview({...preview({scope,requestId:ids.request,settingsId:ids.request,expectedVersion:1}),scanned:100,nextCursor:null});mount(f.client,routes.workspaceSettings(scope.organizationId,scope.workspaceId)+'?retentionBatch='+id);
 await screen.findByRole('button',{name:'Apply deletion of 1 runs'});expect(f.records.some(request=>request.method==='POST')).toBe(false);expect(screen.getByRole('region',{name:'Selected retention batch'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Preview next window'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Apply deletion of 1 runs'}));await screen.findByText('Waiting for authoritative cleanup and settlement confirmation.');expect(f.records.filter(request=>request.path.endsWith('/retention-apply'))).toHaveLength(1);
});
