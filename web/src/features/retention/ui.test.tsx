// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach,expect,it } from 'vitest';
import { cleanup,fireEvent,screen,waitFor } from '@testing-library/react';
import { fixture,runId,preview as proposal,json,id } from './test-fixtures.js';
import { deferred } from '../../app/test-fixtures.js';
afterEach(cleanup);
async function open(){fireEvent.click(screen.getByRole('button',{name:'Manage run retention'}));await screen.findByRole('button',{name:'Preview retention'});}
async function preview(){fireEvent.click(screen.getByRole('button',{name:'Preview retention'}));return screen.findByRole('button',{name:'Apply deletion of 1 runs'});}
it('requires preview and explicit Apply, shows only settlement credit, then explicitly acknowledges completion',async()=>{
 const f=fixture();f.mount();expect(f.records).toHaveLength(0);await open();const apply=await preview();expect(f.records.filter(r=>r.method==='POST')).toHaveLength(1);
 expect(screen.getByText('0 of 1 settled. Confirmed logical credit: 0 bytes.')).toBeInTheDocument();fireEvent.click(apply);
 await screen.findByText('Waiting for authoritative cleanup and settlement confirmation.');expect(screen.queryByRole('button',{name:'Acknowledge completed batch'})).not.toBeInTheDocument();
 f.complete();fireEvent.click(screen.getByRole('button',{name:'Refresh batch'}));await screen.findByText('1 of 1 settled. Confirmed logical credit: 62976 bytes.');
 fireEvent.click(screen.getByRole('button',{name:'Acknowledge completed batch'}));await screen.findByText('No saved batches.');expect(screen.queryByRole('region',{name:'Selected retention batch'})).not.toBeInTheDocument();
});
it('retains one Apply identity across unknown replies without starting another mutation',async()=>{
 let attempts=0;const f=fixture(request=>{if(request.path.endsWith('/retention-apply')&&++attempts===1)return Promise.reject(Error('Synthetic lost reply'));});f.mount();await open();fireEvent.click(await preview());
 await screen.findByText(/Outcome unknown/);expect(screen.getByRole('button',{name:'Preview retention'})).toBeDisabled();expect(attempts).toBe(1);
 fireEvent.click(screen.getByRole('button',{name:'Retry identical retention request'}));await screen.findByText('Waiting for authoritative cleanup and settlement confirmation.');
 const calls=f.records.filter(r=>r.path.endsWith('/retention-apply'));expect(calls).toHaveLength(2);expect(calls[1]!.body).toEqual(calls[0]!.body);
});
it('aborts and fences a late preview reply when controls close; durable batches remain discoverable',async()=>{
 const held=deferred<Response>();const f=fixture(request=>request.path.endsWith('/retention-preview')?held.promise:undefined);f.mount();await open();fireEvent.click(screen.getByRole('button',{name:'Preview retention'}));
 await waitFor(()=>expect(f.records.some(r=>r.path.endsWith('/retention-preview'))).toBe(true));const request=f.records.find(r=>r.path.endsWith('/retention-preview'))!;
 fireEvent.click(screen.getByRole('button',{name:'Close retention controls'}));expect(request.signal?.aborted).toBe(true);held.resolve(new Response('{}',{status:200,headers:{'content-type':'application/json'}}));await Promise.resolve();expect(screen.queryByText(/Apply deletion/)).not.toBeInTheDocument();
});
it('captures manual Run version and defers all reads until explicit opening',async()=>{
 const f=fixture();f.mount({id:runId,version:7});expect(f.records).toHaveLength(0);fireEvent.click(screen.getByRole('button',{name:'Delete this run…'}));
 fireEvent.click(await screen.findByRole('button',{name:'Preview this run deletion'}));await screen.findByRole('button',{name:'Apply deletion of 1 runs'});
 const call=f.records.find(r=>r.path.endsWith('/deletion-preview'))!;expect(call.body).toMatchObject({runId,expectedRunVersion:7});expect(call.path).toContain('/runs/'+runId+'/');
 expect(f.records.some(r=>r.path.endsWith('/retention-apply'))).toBe(false);
});

it('continues an empty window using the stored cursor and displays unknown protected bytes honestly',async()=>{
 const f=fixture(request=>{
  if(request.path.endsWith('/retention-preview')&&!(request.body!.page as {cursor?:string}).cursor){
   const value={...proposal(request.body!),scanned:100,candidates:[],estimatedBytes:0,protectedExclusions:[{reason:'unknown' as const,count:1,estimatedBytes:null}],nextCursor:btoa(id)};f.storePreview(value);return json(value);
  }return undefined;
 });f.mount();await open();fireEvent.click(screen.getByRole('button',{name:'Preview retention'}));
 await screen.findByText('Protected unknown: 1; logical bytes unknown.');expect(screen.getByRole('button',{name:'Apply deletion of 0 runs'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Preview next window'}));await screen.findByRole('button',{name:'Apply deletion of 1 runs'});
 expect(f.records.filter(r=>r.path.endsWith('/retention-preview'))[1]!.body).toMatchObject({page:{limit:100,cursor:btoa(id)}});
 expect(f.records.some(r=>r.path.endsWith('/retention-apply'))).toBe(false);
});
it('refuses expired Apply and allows explicit preview metadata discard',async()=>{
 const f=fixture(request=>{
  if(request.path.endsWith('/retention-preview')){const capturedAt=new Date(Date.now()-900001).toISOString();const value={...proposal(request.body!),capturedAt,expiresAt:new Date(Date.parse(capturedAt)+900000).toISOString()};f.storePreview(value);return json(value);}return undefined;
 });f.mount();await open();expect(await preview()).toBeDisabled();await screen.findByText('This preview expired. Discard it and start a fresh preview.');
 fireEvent.click(screen.getByRole('button',{name:'Discard this preview'}));await screen.findByText('No saved batches.');expect(f.records.some(r=>r.path.endsWith('/retention-apply'))).toBe(false);
});
