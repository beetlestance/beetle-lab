import { expect,it } from 'vitest';
import { createServer,request } from 'node:http';
import type { Server } from 'node:http';
import { encodeCanonicalJson } from '@beetle/contracts';
import offer from '../../../../contracts/fixtures/valid/offer.json' with {type:'json'};
import { offerPauseProxy } from './offer-pause-proxy.js';
async function listen(server:Server){await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('No listener');return `http://127.0.0.1:${address.port}`;}
async function close(server:Server){await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
function put(origin:string,body:unknown,method='PUT',suffix=''){
 const req=request(new URL(`/runner/v1/attempts/${offer.attemptId}${suffix}`,origin),{method,agent:false,headers:{'content-type':'application/json',
  'x-beetle-organization-id':offer.organizationId,'x-beetle-workspace-id':offer.workspaceId}});
 const result=new Promise<{status:number;body:string}>((resolve,reject)=>{req.once('error',reject);req.once('response',reply=>{const chunks:Buffer[]=[];reply.on('data',(data:Buffer)=>chunks.push(data));reply.once('end',()=>resolve({status:reply.statusCode!,body:Buffer.concat(chunks).toString()}));reply.once('error',reject);});});
 req.end(JSON.stringify(body));return{req,result};
}
it('captures one immutable actual Offer and blocks every mutation without any upstream dispatch',async()=>{
 let calls=0;const target=createServer((_request,response)=>{calls++;response.end('unexpected');});const origin=await listen(target);const proxy=await offerPauseProxy(origin);
 try{
  const first=put(proxy.origin,offer);expect(await proxy.first).toBe(encodeCanonicalJson(offer,2097152));expect((await first.result).status).toBe(503);
  expect((await put(proxy.origin,offer).result).status).toBe(503);expect((await put(proxy.origin,offer,'POST','/cancel-original').result).status).toBe(503);
  await proxy.close();expect(calls).toBe(0);expect(proxy.state()).toMatchObject({offered:2,active:0,failures:0});
 }finally{await proxy.close();await close(target);}
});
it('refuses an altered retry without overwriting the captured original',async()=>{
 const target=createServer((_request,response)=>response.end());const origin=await listen(target);const proxy=await offerPauseProxy(origin);
 try{
  await put(proxy.origin,offer).result;const text=await proxy.first;
  await expect(put(proxy.origin,{...offer,budget:{...offer.budget,cpuMillis:offer.budget.cpuMillis+1}}).result).rejects.toBeDefined();
  await proxy.close();expect(await proxy.first).toBe(text);expect(proxy.state().failures).toBe(1);
 }finally{await proxy.close();await close(target);}
});
it('joins a held incoming body and its actual socket on shutdown without publishing an original',async()=>{
 const target=createServer((_request,response)=>response.end());const origin=await listen(target);const proxy=await offerPauseProxy(origin);
 const req=request(new URL(`/runner/v1/attempts/${offer.attemptId}`,proxy.origin),{method:'PUT',agent:false,headers:{'content-type':'application/json'}});
 const ended=new Promise<void>(resolve=>{req.once('error',()=>{});req.once('close',()=>resolve());});req.write('{');
 try{await new Promise<void>(resolve=>req.once('socket',socket=>socket.once('connect',resolve)));await proxy.close();await ended;expect(proxy.state().active).toBe(0);expect(proxy.state().offered).toBe(0);}
 finally{req.destroy();await proxy.close();await close(target);}
});
