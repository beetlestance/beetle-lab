import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage,ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import type { Offer } from '@beetle/contracts';
import { encodeCanonicalJson,RUNNER_MAXIMUM_OFFER_BYTES,validate } from '@beetle/contracts';
import { ProxyForwards } from './proxy-owner.js';
interface Capture {readonly input:IncomingMessage;readonly output:ServerResponse;readonly socket:Socket;readonly closes:readonly Promise<void>[]}
function closed(stream:{once(event:'close',callback:()=>void):unknown}):Promise<void>{return new Promise(resolve=>stream.once('close',resolve));}
async function body(input:IncomingMessage):Promise<unknown>{
 const chunks:Buffer[]=[];let length=0;
 for await(const chunk of input){assert(chunk instanceof Uint8Array);length+=chunk.byteLength;assert(length<=RUNNER_MAXIMUM_OFFER_BYTES&&chunks.length<256);chunks.push(Buffer.from(chunk));}
 return JSON.parse(Buffer.concat(chunks,length).toString('utf8')) as unknown;
}
function paused(input:IncomingMessage,output:ServerResponse):void{
 const organizationId=input.headers['x-beetle-organization-id'];const workspaceId=input.headers['x-beetle-workspace-id'];
 const attemptId=/^\/runner\/v1\/attempts\/([a-f0-9-]{36})(?:\/|$)/.exec(input.url??'')?.[1];
 const error={protocolVersion:'1.0',organizationId,workspaceId,attemptId,reason:'budget_unavailable',retry:'transport',issues:[]};
 assert(validate('ProtocolError',error).ok,'Expected actual scoped runner call');
 output.writeHead(503,{'content-type':'application/json',connection:'close'});output.end(JSON.stringify(error));
}
/** Capture one immutable real Offer; no mutation is ever forwarded in this setup phase. */
export async function offerPauseProxy(origin:string){
 const target=new URL(origin);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.protocol,'http:');
 const forwards=new ProxyForwards(target,10000);const sockets=new Map<Socket,Promise<void>>();const owners=new Map<Capture,Promise<void>>();
 let stopped=false;let closing:Promise<void>|undefined;let canonical:string|undefined;let offered=0;let failures=0;
 let captured!:(text:string)=>void;const first=new Promise<string>(resolve=>{captured=resolve;});
 async function capture(owner:Capture):Promise<void>{
  const timer=setTimeout(()=>{owner.input.destroy();owner.output.destroy();owner.socket.destroy();},10000);
  try{
   const value=await body(owner.input);assert(!stopped&&!owner.input.aborted);
   if(owner.input.method==='PUT'&&/^\/runner\/v1\/attempts\/[a-f0-9-]{36}$/.test(owner.input.url??'')){
    assert(validate('Offer',value).ok);const offer=value as Offer;
    assert.equal(owner.input.url,`/runner/v1/attempts/${offer.attemptId}`);assert.equal(owner.input.headers['x-beetle-organization-id'],offer.organizationId);
    assert.equal(owner.input.headers['x-beetle-workspace-id'],offer.workspaceId);const text=encodeCanonicalJson(value,RUNNER_MAXIMUM_OFFER_BYTES);
    if(canonical!==undefined)assert.equal(text,canonical,'Only one original is permitted');else{canonical=text;captured(text);}offered++;
   }
   paused(owner.input,owner.output);
  }catch{if(!stopped)failures++;owner.input.destroy();owner.output.destroy();owner.socket.destroy();}
  finally{clearTimeout(timer);await Promise.all(owner.closes);owners.delete(owner);}
 }
 const server=createServer((input,output)=>{
  if(stopped){input.destroy();output.destroy();return;}
  if(input.method==='GET'){forwards.handle(input,output);return;}
  if(owners.size>=2){failures++;input.destroy();output.destroy();return;}
  const socket=input.socket;const socketClosed=sockets.get(socket);assert(socketClosed);
  const owner:Capture={input,output,socket,closes:[closed(input),closed(output),socketClosed]};
  const work=Promise.resolve().then(()=>capture(owner));owners.set(owner,work);void work.catch(()=>{failures++;});
 });
 server.on('connection',socket=>{
  if(stopped||sockets.size>=16){failures++;socket.destroy();return;}
  const done=closed(socket).then(()=>{sockets.delete(socket);});sockets.set(socket,done);
 });
 server.headersTimeout=5000;server.requestTimeout=10000;server.keepAliveTimeout=1000;server.maxHeadersCount=32;
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const address=server.address();assert(address&&typeof address==='object');
 return{origin:`http://127.0.0.1:${address.port}`,first,state:()=>({offered,active:owners.size,failures,forwarding:forwards.state()}),close:()=>closing??=(async()=>{
  stopped=true;const pending=[...sockets.values()];const listener=new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  const forwarded=forwards.close();for(const socket of sockets.keys())socket.destroy();
  await Promise.all([listener,forwarded,...owners.values(),...pending]);assert.equal(owners.size,0);assert.equal(sockets.size,0);
 })()};
}
