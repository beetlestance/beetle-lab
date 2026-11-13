import { afterEach } from 'vitest';
import type { FastifyInstance,FastifyRequest } from 'fastify';
import { encodeJson } from '@beetle/contracts';
import { apiSchemas,createApiClient } from '@beetle/contracts/api';
import type { Metadata } from '../../src/adapters/outbound/sqlite/index.js';
import { createApiServer,ApiFault } from '../../src/adapters/inbound/http/api-errors.js';
import { configureSchemaCompilers } from '../../src/adapters/inbound/http/schema-compilers.js';
import { registerRetentionRoutes } from '../../src/adapters/inbound/http/retention/index.js';
import { classifyMetadataError } from '../../src/bootstrap/metadata-errors.js';
import { uuid } from './fixture.js';
const servers=new Set<FastifyInstance>();let sequence=65000;
afterEach(async()=>{for(const server of servers)await server.close();servers.clear();});
export const headers={authorization:'SYNTHETIC_RETENTION_SESSION'};
export const authorize=async(request:FastifyRequest)=>{if(request.headers.authorization!==headers.authorization)throw new ApiFault('unpaired');};
export function http(metadata:Metadata,dropApply=false){
 const server=createApiServer({classify:classifyMetadataError});servers.add(server);configureSchemaCompilers(server,{schemas:apiSchemas,encodeJson});
 if(dropApply)server.addHook('onSend',async(request,_reply,payload)=>{
  if(request.url.endsWith('/retention-apply')){request.raw.socket.destroy();}return payload;
 });
 registerRetentionRoutes(server,{store:metadata.retention,newId:()=>uuid(++sequence),now:()=> '2026-11-14T12:01:00.000Z',authorize});
 return server;
}
export async function client(server:FastifyInstance){
 const baseUrl=await server.listen({host:'127.0.0.1',port:0});
 return createApiClient({baseUrl,fetch:(url,init)=>fetch(url,{...init,headers:{...init?.headers,...headers}})});
}
