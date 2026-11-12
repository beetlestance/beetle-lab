import type {RunnerExportGateway} from '../../src/ports/export-runner.js';
import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {encodeJson} from '@beetle/contracts';
import {apiSchemas,exportContentPath} from '@beetle/contracts/api';
import type {BrowserSession,ExportJob} from '@beetle/contracts/api';
import {createApiServer} from '../../src/adapters/inbound/http/api-errors.js';
import {configureSchemaCompilers} from '../../src/adapters/inbound/http/schema-compilers.js';
import {createLocalSession} from '../../src/adapters/inbound/http/session/index.js';
import {registerExportRoutes} from '../../src/adapters/inbound/http/exports/index.js';
import {classifyMetadataError} from '../../src/bootstrap/metadata-errors.js';
import {startExportRuntime} from '../../src/application/export-runtime/index.js';
import {createOutputTransfers} from '../../src/application/output-transfer/index.js';
import {storageFixture,seed,scope,uuid,requestId} from '../storage/fixture.js';
import {createSuite,append,request} from '../storage/suites-fixture.js';
import {nativeFixture} from '../output-transfer/native-fixture.js';
import {options,createCommand} from './fixture.js';
import {sourceFixture,hash} from './source-fixture.js';
const f=storageFixture();
const host='127.0.0.1:43128';const origin=`http://${host}`;
it('enqueues via authorized public API, replays one immutable receipt, automatically publishes and streams the verified scoped script',async()=>{
 const metadata=await f.open(f.path(),options());await seed(metadata);const body=request();body.config.secrets=[];
 const revision=await append(metadata,await createSuite(metadata),60,body);const input=createCommand(revision.id).request;
 const files=await nativeFixture();const server=createApiServer({classify:classifyMetadataError});
 configureSchemaCompilers(server,{schemas:apiSchemas,encodeJson});const session=createLocalSession({externalOrigin:origin});session.registerRoutes(server);
 const routes=registerExportRoutes(server,{store:metadata.exports,outputs:metadata.exportOutputs,bytes:files.store,newId:randomUUID,digest:hash,
  now:()=>new Date().toISOString(),authorize:session.authorize});
 const base=`/api/v2/organizations/${scope.organizationId}/workspaces/${scope.workspaceId}`;const url=`${base}/revisions/${revision.id}/exports`;
 const paired=await server.inject({method:'POST',url:'/api/v2/auth/pair',headers:{host,origin,'x-beetle-pair':'1'},payload:{bootstrapToken:session.bootstrapToken}});
 const headers={host,origin,cookie:String(paired.headers['set-cookie']).split(';')[0]!,'x-beetle-csrf':paired.json<BrowserSession>().csrfToken};
 const bytes=Buffer.from('export default function () { /* synthetic */ }\n');let source:ReturnType<typeof sourceFixture>|undefined;let offers=0;
 const gateway:Pick<RunnerExportGateway,'exportAttempt'|'output'>={exportAttempt:()=>({offerExport:async()=>{throw Error('Missing original');},cancelExportOriginal:async()=>{throw Error('Unexpected cancellation');},
  snapshot:async()=>{if(!source)throw Error('Missing fixture');return {ok:true as const,value:source.snapshot};},events:async()=>{throw Error('Unexpected events');},ack:async()=>{throw Error('Unexpected ack');}}),
  output:()=>({source:async()=>{if(!source)throw Error('Missing fixture');return {ok:true as const,value:source.envelope};},
   absence:async()=>{throw Error('Unexpected absence');},sourceChunk:async(query:{artifactId:string;manifestDigest:string;sourceDigest:string;offset:number;length:number})=>{
    const chunk=bytes.subarray(query.offset,query.offset+query.length);return {ok:true as const,value:{version:1 as const,artifactId:query.artifactId,manifestDigest:query.manifestDigest,sourceDigest:query.sourceDigest,offset:query.offset,
     nextOffset:query.offset+chunk.length,eof:query.offset+chunk.length===bytes.length,totalBytes:bytes.length,base64:chunk.toString('base64')}};
   }})};
 const transfers=createOutputTransfers({metadata:metadata.exportOutputs,gateway,files:files.store,newWriterId:randomUUID,digest:hash,freeSpaceReserveBytes:0});
 let runtime:ReturnType<typeof startExportRuntime>|undefined;
 try{
  expect((await server.inject({method:'POST',url,headers:{host,origin},payload:input})).statusCode).toBe(401);
  expect((await server.inject({method:'POST',url,headers:{...headers,origin:'http://127.0.0.1:1'},payload:input})).statusCode).toBe(403);
  expect((await server.inject({method:'POST',url,headers,payload:{...input,revisionId:uuid(999)}})).statusCode).toBe(404);
  expect((await server.inject({method:'POST',url,headers,payload:{...input,options:{...input.options,maximumBuildBytes:input.budget.outputBytes}}})).statusCode).toBe(422);
  const response=await server.inject({method:'POST',url,headers,payload:input});expect(response.statusCode).toBe(202);const job=response.json<ExportJob>();
  expect((await server.inject({method:'POST',url,headers,payload:input})).json()).toEqual(job);
  expect((await server.inject({url:`${base}/exports/profiles`,headers})).json()).toMatchObject({profiles:['standard']});
  const content=exportContentPath({organizationId:scope.organizationId,workspaceId:scope.workspaceId,exportId:job.id});
  expect((await server.inject({url:content,headers})).statusCode).toBe(409);
  gateway.exportAttempt=()=>({offerExport:async()=>{
   offers++;const key={scope,id:job.id};const original=await metadata.exportExecutions.original(key);const control=await metadata.exportExecutions.control(key);
   source=sourceFixture(original,control,bytes);return {ok:true as const,value:source.snapshot};
  },cancelExportOriginal:async()=>{throw Error('Unexpected');},snapshot:async()=>({ok:true as const,value:source!.snapshot}),
  events:async()=>{throw Error('Unexpected');},ack:async()=>{throw Error('Unexpected');}});
  runtime=startExportRuntime({executions:metadata.exportExecutions,outputs:metadata.exportOutputs,gateway,transfers,intervalMs:25,onFailure:async error=>{throw error;}});
  for(let n=0;n<100;n++){const value=await metadata.exports.get({scope,id:job.id});if(value.state==='ready')break;await new Promise(resolve=>setTimeout(resolve,10));}
  expect((await server.inject({url:`${base}/exports/${job.id}`,headers})).json()).toMatchObject({state:'ready',artifact:{bytes:bytes.length,sha256:hash(bytes)}});
  expect(offers).toBe(1);
  const full=await server.inject({url:content,headers});expect(full.statusCode).toBe(200);expect(full.rawPayload).toEqual(bytes);
  expect(full.headers['content-type']).toBe('text/javascript; charset=utf-8');expect(full.headers['content-disposition']).toMatch(/\.js"$/);
  const partial=await server.inject({url:content,headers:{...headers,range:'bytes=2-5'}});expect(partial.statusCode).toBe(206);expect(partial.rawPayload).toEqual(bytes.subarray(2,6));
  expect((await server.inject({url:content.replace(scope.workspaceId,uuid(999)),headers})).statusCode).toBe(404);
  expect((await server.inject({url:`${base}/exports?limit=1`,headers})).json()).toMatchObject({items:[{id:job.id,state:'ready'}]});
  await runtime.close();runtime=undefined;
  const next=await server.inject({method:'POST',url,headers,payload:{...input,requestId:requestId()}});const second=next.json<ExportJob>();
  const cancelled=await server.inject({method:'POST',url:`${base}/exports/${second.id}/cancel`,headers,payload:{scope,requestId:requestId()}});
  expect(cancelled.statusCode).toBe(200);expect(cancelled.json()).toMatchObject({cancellationRequested:true});
 }finally{await runtime?.close();await transfers.close();session.close();await routes.close();await server.close();await files.dispose();}
});
