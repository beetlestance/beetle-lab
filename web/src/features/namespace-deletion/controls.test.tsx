// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {apiError,json,mount,readNamespace,testClient,org} from '../../app/test-fixtures.js';
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
