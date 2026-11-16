// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {apiError,json,mount,readNamespace,testClient,org,ids,workspace} from '../../app/test-fixtures.js';
afterEach(cleanup);
it('confirms empty-only deletion and retries an unknown outcome with the identical versioned request',async()=>{
 let writes=0;
 const api=testClient(request=>{
  if(request.method==='GET')return readNamespace(request);
  writes++;if(writes===1)return json(apiError('storage_unavailable'),503);
  return json({id:org().id,scope:org().scope,version:2,state:'tombstoned',cleanup:'complete',requestId:request.body!.requestId});
 });
 mount(api.client);
 const buttons=await screen.findAllByRole('button',{name:'Delete Same organization'});fireEvent.click(buttons[0]!);
 expect(screen.getByText(/Only empty namespaces/)).toBeVisible();
 fireEvent.change(screen.getByLabelText('Confirm deletion of Same organization'),{target:{value:'DELETE'}});
 fireEvent.click(screen.getByRole('button',{name:'Save'}));
 fireEvent.click(await screen.findByRole('button',{name:'Retry identical request'}));
 await screen.findByText('Changes saved.');
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
 expect(screen.getByText(/Retained history still uses storage/)).toBeVisible();
 fireEvent.change(screen.getByLabelText('Confirm deletion of Same workspace'),{target:{value:'DELETE'}});
 fireEvent.click(screen.getByRole('button',{name:'Save'}));await screen.findByText('Changes saved.');
 expect(screen.queryByRole('link',{name:'Same workspace'})).not.toBeInTheDocument();expect(overviewReads).toBeGreaterThanOrEqual(2);
});
