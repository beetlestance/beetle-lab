import { afterEach,expect,it } from 'vitest';
import { request as httpRequest } from 'node:http';
import type { Worker } from 'node:worker_threads';
import { post } from '../retirement-http/fixtures.js';
import { fixture } from '../storage-settlement/fixtures.js';
import { deferred } from '../output-collection/fixture.js';
import { StorageSettlement } from '../../src/storage-settlement/index.js';
import { createAgentServer } from '../../src/transport/index.js';
import { cleanupAccess } from '../../src/cleanup-access/index.js';
const f=fixture();const closes:(()=>Promise<unknown>)[]=[];
afterEach(async()=>{for(const close of closes.splice(0))await close();});
const unused=async():Promise<never>=>{throw Error('Unexpected service');};
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
it('holds disconnected HTTP and shutdown until an issued failed carrier actually terminates',async()=>{
 const e=await f.cleaned();e.fence.release();const service=new StorageSettlement({journal:e.owner});
 let committedReply:unknown;const committed=deferred<void>();const receive=Reflect.get(e.owner,'receive') as (reply:unknown)=>void;
 Reflect.set(e.owner,'receive',(reply:unknown)=>{
  const value=reply&&typeof reply==='object'?Reflect.get(reply,'value'):undefined;
  if(value&&typeof value==='object'&&Reflect.get(value,'state')==='settled'){committedReply=value;committed.resolve();return;}
  receive.call(e.owner,reply);
 });
 const worker=Reflect.get(e.owner,'worker') as Worker;const terminate=worker.terminate.bind(worker);
 const release=deferred<void>();const terminating=deferred<void>();
 worker.terminate=()=>{terminating.resolve();return release.promise.then(terminate);};
 const options={credential:'S'.repeat(64),journalAuthority:e.request.retirement.journalAuthority,journal:e.owner,
  installation:{enqueue:unused,enqueueExport:unused,cancel:unused,cancelOriginal:unused,cancelExportOriginal:unused},capabilities:unused,settlement:service};
 const server=createAgentServer(options);
 const origin=await server.listen({host:'127.0.0.1',port:0});
 closes.push(()=>server.close(),()=>service.close());
 const req=httpRequest(new URL(`/runner/v1/attempts/${e.key.attemptId}/output-settlement`,origin),{method:'POST',agent:false,
  headers:{authorization:`Bearer ${'S'.repeat(64)}`,'content-type':'application/json','x-beetle-organization-id':e.key.organizationId,
   'x-beetle-workspace-id':e.key.workspaceId,'x-beetle-generation':'1','x-beetle-journal-authority':e.request.retirement.journalAuthority}});
 req.on('error',()=>{});req.end(JSON.stringify(e.request));
 try{
  await committed.promise;req.destroy();service.stop();
  let closed=false;const closing=server.close().then(()=>{closed=true;});
  const aborting=e.owner.abort();await terminating.promise;await turn();
  expect(closed).toBe(false);expect(service.status().retained).toBe(1);
  expect(cleanupAccess(e.owner.retirements).status().fences).toBe(1);
  release.resolve();await aborting;await closing;await service.close();
  expect(service.status().retained).toBe(0);expect(cleanupAccess(e.owner.retirements).status().fences).toBe(0);
 }finally{release.resolve();req.destroy();await e.owner.abort();}
 const owner=await f.open(e.journalPath);const replayService=new StorageSettlement({journal:owner});
 const replayServer=createAgentServer({...options,journal:owner,settlement:replayService});
 closes.push(()=>replayServer.close(),()=>replayService.close());
 const replayOrigin=await replayServer.listen({host:'127.0.0.1',port:0});
 const headers={authorization:`Bearer ${'S'.repeat(64)}`,'x-beetle-organization-id':e.key.organizationId,'x-beetle-workspace-id':e.key.workspaceId,
  'x-beetle-generation':'1','x-beetle-journal-authority':e.request.retirement.journalAuthority};
 const response=await post(replayOrigin,`/runner/v1/attempts/${e.key.attemptId}/output-settlement`,headers,e.request).result;
 expect(response.status).toBe(200);expect(JSON.parse(response.body)).toEqual(committedReply);
});
