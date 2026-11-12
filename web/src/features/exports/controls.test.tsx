// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {afterEach,expect,it} from 'vitest';
import {cleanup,fireEvent,screen,waitFor,act} from '@testing-library/react';
import type {CreateExportRequest} from '@beetle/contracts/api';
import {exportContentPath} from '@beetle/contracts/api';
import {ExportSavedRevision} from './index.js';
import {ExportJobView} from './Job.js';
import {queryKeys} from '../../app/queries.js';
import {environment,testClient,json,deferred,revision,exportSettings,exportJob,runId} from './fixtures.js';
afterEach(cleanup);
it('retains an unknown create intent, replays identical bytes, reads current state and exposes only the ready scoped download',async()=>{
 let posts=0;let accepted:ReturnType<typeof exportJob>|undefined;const rev=revision();
 const api=testClient(request=>{
  if(request.method==='POST'){
   posts++;if(posts===1)throw Error('Synthetic lost acceptance');accepted=exportJob(request.body as unknown as CreateExportRequest);return json(accepted,202);
  }
  if(request.path.endsWith('/exports/profiles'))return json({scope:rev.scope,profiles:['k6']});
  if(request.path.includes('/settings'))return json(exportSettings());
  if(request.path.includes('/exports?'))return json({scope:rev.scope,items:accepted?[accepted]:[],nextCursor:null});
  if(request.path.endsWith(`/exports/${runId}`))return json({...accepted,state:'ready',artifact:{artifactId:rev.id,bytes:123,sha256:'e'.repeat(64),name:'suite.js',mediaType:'text/javascript'}});
  throw Error('Unexpected fixture route');
 });
 const e=environment(api.client);e.mount(<ExportSavedRevision revision={rev}/>);
 fireEvent.click(screen.getByRole('button',{name:'Standalone script exports'}));await screen.findByRole('button',{name:'Generate standalone script'});
 fireEvent.click(screen.getByRole('button',{name:'Generate standalone script'}));
 await screen.findByText('The outcome is unknown. Check export history or replay the identical request.');
 expect(screen.getByRole('button',{name:'Generate standalone script'})).toBeDisabled();expect(screen.queryByRole('link',{name:'Download standalone script'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Replay export request'}));await screen.findByRole('button',{name:'View submitted export'});
 const writes=api.records.filter(record=>record.method==='POST');expect(writes).toHaveLength(2);expect(writes[0]!.body).toEqual(writes[1]!.body);
 expect(writes[0]!.body).toMatchObject({revisionId:rev.id,engineProfile:'k6',options:{maximumBuildBytes:1048576,scriptTimeoutMs:180000}});
 fireEvent.click(screen.getByRole('button',{name:'View submitted export'}));const link=await screen.findByRole('link',{name:'Download standalone script'});
 expect(link).toHaveAttribute('href',exportContentPath({organizationId:rev.scope.organizationId,workspaceId:rev.scope.workspaceId,exportId:runId}));
 expect(screen.queryByRole('button',{name:'Cancel export'})).toBeNull();expect(api.records.some(record=>record.path.includes('/runs'))).toBe(false);
});
it('replays unknown cancellation with the same request and blocks fresh concurrent cancellation',async()=>{
 let calls=0;const job=exportJob();const api=testClient(request=>{
  if(request.method!=='POST')throw Error('Unexpected read');calls++;if(calls===1)throw Error('Lost cancellation');return json({...job,cancellationRequested:true,version:2});
 });
 environment(api.client).mount(<ExportJobView job={job}/>);fireEvent.click(screen.getByRole('button',{name:'Cancel export'}));
 await screen.findByRole('button',{name:'Replay export cancellation'});expect(screen.getByRole('button',{name:'Cancel export'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Replay export cancellation'}));await waitFor(()=>expect(api.records).toHaveLength(2));
 expect(api.records[0]!.body).toEqual(api.records[1]!.body);
});
it('retires scoped queries and prevents late profile replies from repopulating removed cache',async()=>{
 const held=deferred<Response>();const rev=revision();const api=testClient(request=>{
  if(request.path.endsWith('/exports/profiles'))return held.promise;
  if(request.path.includes('/settings'))return json(exportSettings());
  return json({scope:rev.scope,items:[],nextCursor:null});
 });
 const e=environment(api.client);const view=e.mount(<ExportSavedRevision revision={rev}/>);
 fireEvent.click(screen.getByRole('button',{name:'Standalone script exports'}));await waitFor(()=>expect(api.records.some(record=>record.path.endsWith('/exports/profiles'))).toBe(true));
 view.unmount();expect(api.records.find(record=>record.path.endsWith('/exports/profiles'))!.signal!.aborted).toBe(true);
 await act(async()=>held.resolve(json({scope:rev.scope,profiles:['k6']})));
 expect(e.client.getQueryCache().findAll({queryKey:queryKeys.exports(rev.scope.organizationId,rev.scope.workspaceId)})).toHaveLength(0);
});
it('does not offer generation when the installed offline catalogue is empty',async()=>{
 const rev=revision();const api=testClient(request=>request.path.endsWith('/exports/profiles')?json({scope:rev.scope,profiles:[]}):request.path.includes('/settings')?json(exportSettings()):json({scope:rev.scope,items:[],nextCursor:null}));
 environment(api.client).mount(<ExportSavedRevision revision={rev}/>);fireEvent.click(screen.getByRole('button',{name:'Standalone script exports'}));
 await screen.findByText('No offline export engine is configured for this installation.');expect(screen.queryByRole('button',{name:'Generate standalone script'})).toBeNull();
 expect(api.records.every(record=>record.method==='GET')).toBe(true);
});
