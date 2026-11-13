import { afterEach,expect,it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { fixture } from '../storage-settlement/fixtures.js';
import { post } from '../retirement-http/fixtures.js';
import { createAgentServer } from '../../src/transport/index.js';
import { StorageSettlement } from '../../src/storage-settlement/index.js';
import { captureSettlementReply } from '@beetle/contracts/output-settlement';
import { retirementDigest } from '../../src/retirement-values/index.js';
const f=fixture();const closes:(()=>Promise<unknown>)[]=[];
afterEach(async()=>{for(const close of closes.splice(0))await close();});
const unused=async():Promise<never>=>{throw Error('Unexpected service');};
async function http(){
 const e=await f.cleaned();e.fence.release();const service=new StorageSettlement({journal:e.owner});let calls=0;
 const server:FastifyInstance=createAgentServer({credential:'S'.repeat(64),journalAuthority:e.request.retirement.journalAuthority,journal:e.owner,
  installation:{enqueue:unused,enqueueExport:unused,cancel:unused,cancelOriginal:unused,cancelExportOriginal:unused},capabilities:unused,
  settlement:{settle:(body,operation)=>{calls++;return service.settle(body,operation);}}});
 closes.push(()=>server.close(),()=>service.close());const origin=await server.listen({host:'127.0.0.1',port:0});
 const path=`/runner/v1/attempts/${e.key.attemptId}/output-settlement`;
 const headers={authorization:`Bearer ${'S'.repeat(64)}`,'x-beetle-organization-id':e.key.organizationId,'x-beetle-workspace-id':e.key.workspaceId,
  'x-beetle-generation':'1','x-beetle-journal-authority':e.request.retirement.journalAuthority};
 return{...e,server,service,origin,path,headers,calls:()=>calls};
}
it('settles actual cleaned metadata over authenticated TCP and replays without more native effects',async()=>{
 const e=await http();const before={effects:e.effects.length,docker:e.docker.calls.length,opened:e.opened.length};
 const response=await post(e.origin,e.path,e.headers,e.request).result;expect(response.status).toBe(200);
 const reply=captureSettlementReply(JSON.parse(response.body),e.request,retirementDigest);
 expect(reply.state).toBe('settled');expect(response.headers.connection).toBe('close');
 const replay=await post(e.origin,e.path,e.headers,e.request).result;expect(replay.status).toBe(200);expect(JSON.parse(replay.body)).toEqual(reply);
 expect({effects:e.effects.length,docker:e.docker.calls.length,opened:e.opened.length}).toEqual(before);
 await expect(e.owner.get(e.key)).rejects.toMatchObject({code:'conflict'});
});
it.each(['auth','scope','header-authority','body-authority','path','extra','size','generation'] as const)('refuses %s before settlement dispatch',async kind=>{
 const e=await http();const foreign='00000000-0000-4000-8000-000000000999';
 const headers={...e.headers,...(kind==='auth'?{authorization:'Bearer wrong'}:{}),...(kind==='scope'?{'x-beetle-workspace-id':foreign}:{}),
  ...(kind==='header-authority'?{'x-beetle-journal-authority':foreign}:{}),...(kind==='generation'?{'x-beetle-generation':'2'}:{})};
 const body={...e.request,retirement:{...e.request.retirement,...(kind==='body-authority'?{journalAuthority:foreign}:{})},
  ...(kind==='extra'?{path:'/wrong'}:{}),...(kind==='size'?{padding:'x'.repeat(4096)}:{})};
 const path=kind==='path'?`/runner/v1/attempts/${foreign}/output-settlement`:e.path;
 const response=await post(e.origin,path,headers,body).result;expect(response.status).toBeGreaterThanOrEqual(400);expect(e.calls()).toBe(0);
 expect(await e.owner.get(e.key)).toBeDefined();
});
it('refuses a mismatched cleaned ACK without compaction and accepts the subsequent exact instruction',async()=>{
 const e=await http();const conflict=await post(e.origin,e.path,e.headers,{...e.request,cleanupReplyDigest:'0'.repeat(64)}).result;
 expect(conflict.status).toBe(409);expect(await e.owner.get(e.key)).toBeDefined();
 expect((await post(e.origin,e.path,e.headers,e.request).result).status).toBe(200);
});
