import { observation } from '../admission/fixtures.js';
import { afterEach,expect,it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createAgentServer } from '../../src/transport/index.js';
import { StorageSettlement } from '../../src/storage-settlement/index.js';
import { cleanedReplyDigest } from '@beetle/contracts/output-settlement';
import { retirementDigest } from '../../src/retirement-values/index.js';
import { post } from '../retirement-http/fixtures.js';
import { fixture } from './fixtures.js';
const f=fixture();const servers:FastifyInstance[]=[];const settlements:StorageSettlement[]=[];
afterEach(async()=>{for(const server of servers.splice(0))await server.close();for(const service of settlements.splice(0))await service.close();});
it.each(['rejected','admitted'] as const)('serves genuine %s no-task cleanup and permanent settlement replay over authenticated TCP',async mode=>{
 const e=await f.composed(mode);const service=new StorageSettlement({journal:e.owner});settlements.push(service);
 const server=createAgentServer({journal:e.owner,journalAuthority:e.request.journalAuthority,credential:'S'.repeat(64),installation:e.manager,
  capabilities:async()=>{throw Error('Unexpected capabilities');},settlement:service,
  cleanup:{tick:(request,operation)=>e.pipeline.tickWithPorts(request,operation,e.ports)}});servers.push(server);
 const origin=await server.listen({host:'127.0.0.1',port:0});const path=`/runner/v1/attempts/${e.key.attemptId}`;
 const headers={authorization:`Bearer ${'S'.repeat(64)}`,'x-beetle-organization-id':e.key.organizationId,'x-beetle-workspace-id':e.key.workspaceId,
  'x-beetle-generation':'1','x-beetle-journal-authority':e.request.journalAuthority};
 await e.owner.admission({kind:'observe',observation:observation(Date.now())});
 const cleaned=await post(origin,`${path}/output-retirement`,headers,e.request).result;expect(cleaned.status,cleaned.body).toBe(200);
 const reply:unknown=JSON.parse(cleaned.body);expect(reply).toMatchObject({state:'cleaned'});
 const request={version:1,retirement:e.request,cleanupReplyDigest:cleanedReplyDigest(reply,e.request,retirementDigest)};
 const settled=await post(origin,`${path}/output-settlement`,headers,request).result;expect(settled.status).toBe(200);
 expect(JSON.parse(settled.body) as unknown).toMatchObject({state:'settled',chargedBytes:4096});
 expect((await post(origin,`${path}/output-settlement`,headers,request).result).body).toBe(settled.body);
 const replay=await post(origin,`${path}/output-retirement`,headers,e.request).result;expect(JSON.parse(replay.body) as unknown).toEqual(reply);
 expect(cleanedReplyDigest(JSON.parse(replay.body) as unknown,e.request,retirementDigest)).toBe(request.cleanupReplyDigest);
 expect(e.docker.calls).toHaveLength(8);
});
