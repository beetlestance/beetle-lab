import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {Socket} from 'node:net';
import {ProxyForwards} from './proxy-owner.js';
/** Bounded task-owned real TCP peer; never part of ordinary application startup. */
export async function retirementProxy(origin:string,operationMs=10000){
 const target=new URL(origin);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.protocol,'http:');
 assert(Number.isSafeInteger(operationMs)&&operationMs>=25&&operationMs<=10000);
 let closing:Promise<void>|undefined;let shuttingDown=false;const sockets=new Map<Socket,Promise<void>>();const forwards=new ProxyForwards(target,operationMs);
 const server=createServer((incoming,response)=>forwards.handle(incoming,response));
 server.on('connection',socket=>{if(sockets.size>=16||shuttingDown){forwards.refuse();socket.destroy();return;}const ended=new Promise<void>(resolve=>socket.once('close',()=>{sockets.delete(socket);resolve();}));sockets.set(socket,ended);});
 server.headersTimeout=5000;server.requestTimeout=10000;server.keepAliveTimeout=1000;server.maxHeadersCount=32;
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const address=server.address();assert(address&&typeof address==='object');
 return {origin:`http://127.0.0.1:${address.port}`,state:()=>forwards.state(),close:()=>closing??=(async()=>{
  shuttingDown=true;const incoming=[...sockets.values()];const stopped=new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));const originals=forwards.close();
  for(const socket of sockets.keys())socket.destroy();await Promise.all([stopped,originals]);await Promise.all([...incoming,...sockets.values()]);assert.equal(sockets.size,0);
 })()};
}
