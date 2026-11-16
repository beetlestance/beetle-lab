import { afterEach } from 'vitest';
import { request } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { createAgentServer } from '../../src/transport/index.js';
import { fixture as pipelineFixture } from '../retirement-pipeline/fixtures.js';
import type { PipelineNativePorts } from '../../src/retirement-pipeline/index.js';
const unused=async():Promise<never>=>{throw Error('Unexpected unrelated service');};
export function fixture(){const f=pipelineFixture();const servers:FastifyInstance[]=[];afterEach(async()=>{await Promise.all(servers.splice(0).map(server=>server.close()));});
 return{...f,async http(maximumSteps=16,override?:(ports:PipelineNativePorts)=>PipelineNativePorts){
  const e=await f.pipeline(maximumSteps);const ports=override?override(e.ports):e.ports;let calls=0;
  const server=createAgentServer({credential:'S'.repeat(64),journalAuthority:e.request.journalAuthority,
   installation:{enqueue:unused,enqueueExport:unused,cancel:unused,cancelOriginal:unused,cancelExportOriginal:unused},journal:e.owner,capabilities:unused,
   cleanup:{tick:(body,operation)=>{calls++;return e.pipeline.tickWithPorts(body,operation,ports);}}});servers.push(server);
  const origin=await server.listen({host:'127.0.0.1',port:0});const path=`/runner/v1/attempts/${e.request.attemptId}/output-retirement`;
  const headers={authorization:`Bearer ${'S'.repeat(64)}`,'x-beetle-organization-id':e.request.organizationId,'x-beetle-workspace-id':e.request.workspaceId,
   'x-beetle-generation':'1','x-beetle-journal-authority':e.request.journalAuthority};
  return{...e,server,origin,path,headers,calls:()=>calls};
 }};
}
export function post(origin:string,path:string,headers:Record<string,string>,body:unknown){
 const text=typeof body==='string'?body:JSON.stringify(body);const req=request(new URL(path,origin),{method:'POST',agent:false,headers:{...headers,'content-type':'application/json','content-length':String(Buffer.byteLength(text)),connection:'close'}});
 const result=new Promise<{status:number;body:string;headers:IncomingHttpHeaders}>((resolve,reject)=>{
  req.once('error',reject);req.once('response',response=>{const chunks:Buffer[]=[];let bytes=0;response.on('data',(chunk:Buffer)=>{
   bytes+=chunk.length;if(bytes>4096||chunks.length>=64){req.destroy();reject(Error('Reply overflow'));return;}chunks.push(chunk);});
   response.once('error',reject);response.once('end',()=>resolve({status:response.statusCode!,body:Buffer.concat(chunks).toString(),headers:response.headers}));});
 });req.end(text);return{req,result};
}
