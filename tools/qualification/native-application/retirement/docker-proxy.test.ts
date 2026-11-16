import { tmpdir } from 'node:os';
import {expect,it} from 'vitest';
import {createServer,request} from 'node:http';
import type {Server} from 'node:http';
import { mkdtemp, readFile, rm, realpath } from 'node:fs/promises';
import {join} from 'node:path';
import {runDockerProxy} from './docker-proxy.js';
import {bounded} from './metadata.js';
const installationId='00000000-0000-4000-8000-000000000001';const runtimeId='b'.repeat(64);const runtimeName=`beetle-${'a'.repeat(64)}`;
async function close(server:Server){await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
function call(socketPath:string,path:string,method='GET'){
 const outgoing=request({socketPath,path,method,agent:false});const result=new Promise<{status:number;contentType:string|undefined}>((resolve,reject)=>{outgoing.once('error',reject);outgoing.once('response',response=>{response.resume();response.once('end',()=>resolve({status:response.statusCode!,contentType:response.headers['content-type']}));response.once('error',reject);});});outgoing.end();return {outgoing,result};
}
async function fixture(foreign=false){
 const root=await mkdtemp(join(await realpath(tmpdir()), 'beetle-docker-proxy-'));const upstreamSocketPath=join(root,'up.sock');const socketPath=join(root,'proxy.sock');const markerPath=join(root,'marker.json');let deletes=0;let finished=false;
 const server=createServer((incoming,response)=>{response.setHeader('content-type','application/json');if(incoming.method==='DELETE'){deletes++;response.writeHead(204);response.end();response.once('finish',()=>{finished=true;});return;}
  response.end(JSON.stringify({Id:runtimeId,Name:`/${runtimeName}`,Config:{Labels:{'dev.beetle.installation':foreign?'foreign':installationId}}}));});
 await new Promise<void>(resolve=>server.listen(upstreamSocketPath,resolve));const proxy=await runDockerProxy({socketPath,upstreamSocketPath,markerPath,installationId,runtimeId,runtimeName});
 return {root,server,proxy,socketPath,markerPath,deletes:()=>deletes,finished:()=>finished};
}
it('marks only a settled exact owned DELETE, holds its real downstream reply and drains after crash',async()=>{
 const f=await fixture();let pending:ReturnType<typeof call>|undefined;
 try{
  expect(await call(f.socketPath,`/v1.47/containers/${runtimeId}/json`).result).toEqual({status:200,contentType:'application/json'});pending=call(f.socketPath,`/v1.47/containers/${runtimeId}?force=false&v=false`,'DELETE');
  let settled=false;void pending.result.then(()=>{settled=true;},()=>{settled=true;});
  let marker:unknown;await bounded((async()=>{for(let attempts=0;attempts<100;attempts++){try{marker=JSON.parse(await readFile(f.markerPath,'utf8'));return;}catch{await new Promise(resolve=>setTimeout(resolve,10));}}throw Error('No marker');})(),'No settled fault marker');
  expect(marker).toEqual({version:1,installationId,runtimeId});expect(f.finished()).toBe(true);expect(f.deletes()).toBe(1);expect(settled).toBe(false);
  const failed=expect(pending.result).rejects.toBeTruthy();pending.outgoing.destroy();await failed;await f.proxy.close();expect(f.proxy.state()).toMatchObject({active:0,sockets:0,faulted:true,failures:0,refused:0});
 }finally{pending?.outgoing.destroy();await f.proxy.close();await close(f.server);await rm(f.root,{recursive:true,force:true});}
});
it.each([false,true])('refuses unobserved or foreign mutation before any actual Docker DELETE (foreign=%s)',async foreign=>{
 const f=await fixture(foreign);
 try{if(foreign)await call(f.socketPath,`/v1.47/containers/${runtimeId}/json`).result;
  expect(await call(f.socketPath,`/v1.47/containers/${runtimeId}?force=false&v=false`,'DELETE').result).toMatchObject({status:403});expect(f.deletes()).toBe(0);expect(f.proxy.state().faulted).toBe(false);
  await expect(readFile(f.markerPath)).rejects.toMatchObject({code:'ENOENT'});
 }finally{await f.proxy.close();await close(f.server);await rm(f.root,{recursive:true,force:true});}
});
