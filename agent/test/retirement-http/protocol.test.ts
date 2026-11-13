import { expect,it } from 'vitest';
import { fixture,post } from './fixtures.js';
import { captureOutputRetirementReply } from '@beetle/contracts/output-retirement';
import { retirementDigest } from '../../src/retirement-values/index.js';
const f=fixture();
it('serves actual trusted native cleanup over authenticated TCP and repeats proof on receipt replay',async()=>{
 const e=await f.http();const response=await post(e.origin,e.path,e.headers,e.request).result;
 expect(response.status).toBe(200);expect(response.headers.connection).toBe('close');const reply=captureOutputRetirementReply(JSON.parse(response.body),e.request,retirementDigest);expect(reply.state).toBe('cleaned');
 const effects=e.effects.length;const replay=await post(e.origin,e.path,e.headers,e.request).result;expect(replay.status).toBe(200);expect(JSON.parse(replay.body)).toEqual(reply);expect(e.effects).toHaveLength(effects);expect(e.calls()).toBe(2);
});
it('reports pending bounded progress then converges through repeated exact requests',async()=>{
 const e=await f.http(1);let state='pending';let count=0;
 while(state==='pending'&&count++<16){const reply=await post(e.origin,e.path,e.headers,e.request).result;expect(reply.status).toBe(200);state=captureOutputRetirementReply(JSON.parse(reply.body),e.request,retirementDigest).state;}
 expect(state).toBe('cleaned');expect(count).toBeGreaterThan(1);
});
it.each(['auth','scope','header-authority','body-authority','path','extra','size','generation'] as const)('refuses %s before pipeline dispatch',async kind=>{
 const e=await f.http();const foreign='00000000-0000-4000-8000-000000000999';
 const headers={...e.headers,...(kind==='auth'?{authorization:'Bearer wrong'}:{}),...(kind==='scope'?{'x-beetle-workspace-id':foreign}:{}),...(kind==='header-authority'?{'x-beetle-journal-authority':foreign}:{}),...(kind==='generation'?{'x-beetle-generation':'2'}:{})};
 const body={...e.request,...(kind==='body-authority'?{journalAuthority:foreign}:{}),...(kind==='extra'?{path:'/wrong'}:{}),...(kind==='size'?{padding:'x'.repeat(4096)}:{})};
 const path=kind==='path'?`/runner/v1/attempts/${foreign}/output-retirement`:e.path;
 const response=await post(e.origin,path,headers,body).result;expect(response.status).toBeGreaterThanOrEqual(400);expect(e.calls()).toBe(0);expect(e.effects).toHaveLength(0);
});
