// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CreateRunRequest, Suite } from '@beetle/contracts/api';
import { environment, json, testClient } from '../exports/fixtures.js';
import { revision, settings } from '../runs/test-fixtures.js';
import { StartRun } from './StartRun.js';
afterEach(cleanup);
const saved=revision();
const suite:Suite={id:saved.suiteId,scope:saved.scope,name:'Checkout',version:1,folderId:saved.id,currentRevisionId:saved.id};
it('offers the selected revision outside the comparison page and freezes its note for unknown-outcome replay',async()=>{
 const api=testClient(request=>{
  if(request.method==='POST')return new Response('',{status:503});
  if(request.path.endsWith('/settings'))return json(settings());
  if(request.path.endsWith('/revisions/'+saved.id))return json(saved);
  throw Error('Unexpected synthetic route');
 });
 const earlier={...saved,id:'44444444-4444-4444-8444-444444444444',ordinal:1,previousRevisionId:null};
 environment(api.client).mount(<MemoryRouter><StartRun suite={suite} workspaceName="Checkout" revisions={[earlier]}
  initialRevisionId={saved.id} close={()=>undefined}/></MemoryRouter>);
 const choice=await screen.findByRole('option',{name:'Revision 2 (latest)'});
 expect(choice).toHaveProperty('selected',true);
 const note=screen.getByRole('textbox',{name:'Note for this run (optional)'});
 fireEvent.change(note,{target:{value:' After connection-pool fix '}});
 fireEvent.click(screen.getByRole('button',{name:'Start run'}));
 await screen.findByRole('button',{name:'Replay original request'});
 expect(note).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Replay original request'}));
 await screen.findByRole('button',{name:'Replay original request'});
 const posts=api.records.filter(request=>request.method==='POST');
 expect(posts).toHaveLength(2);expect(posts[1]!.body).toEqual(posts[0]!.body);
 expect((posts[0]!.body as unknown as CreateRunRequest).note).toBe(' After connection-pool fix ');
 expect((posts[0]!.body as unknown as CreateRunRequest).revisionId).toBe(saved.id);
 expect(api.records.every(request=>!request.path.endsWith('/note'))).toBe(true);
});
