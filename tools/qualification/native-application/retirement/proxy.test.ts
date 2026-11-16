import {expect,it,vi} from 'vitest';
import {createServer,request,IncomingMessage,ServerResponse} from 'node:http';
import {Socket} from 'node:net';
import {ProxyForwards} from './proxy-owner.js';
import type {Server} from 'node:http';
import {retirementProxy} from './proxy.js';
import {bounded} from './metadata.js';
async function listen(server:Server){await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const value=server.address();if(!value||typeof value==='string')throw Error('No listener');return `http://127.0.0.1:${value.port}`;}
async function close(server:Server){await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
function get(origin:string){const outgoing=request(new URL('/runner/v1/capabilities',origin),{agent:false});
 const result=new Promise<void>((resolve,reject)=>{outgoing.once('error',reject);outgoing.once('response',response=>{response.resume();response.once('end',resolve);response.once('error',reject);});});outgoing.end();return result;
}
it('ends a continuously progressing upstream at the absolute budget and drains the actual TCP owners',async()=>{
 let chunks=0;let released!:()=>void;const socketClosed=new Promise<void>(resolve=>{released=resolve;});
 const target=createServer((incoming,response)=>{const timer=setInterval(()=>{chunks++;response.write('x');},5);incoming.socket.once('close',()=>{clearInterval(timer);released();});});
 const origin=await listen(target);const proxy=await retirementProxy(origin,100);
 try{await expect(bounded(get(proxy.origin),'Proxy did not enforce absolute deadline',2000)).rejects.toBeTruthy();await proxy.close();await bounded(socketClosed,'Upstream did not close',2000);
  expect(chunks).toBeGreaterThan(1);expect(proxy.state().active).toBe(0);expect(proxy.state().failures).toBe(1);
 }finally{await proxy.close();await close(target);}
});
it('closes a held forwarding request and awaits its actual socket before completing proxy shutdown',async()=>{
 let entered!:()=>void;let released!:()=>void;const called=new Promise<void>(resolve=>{entered=resolve;});const socketClosed=new Promise<void>(resolve=>{released=resolve;});
 const target=createServer((incoming)=>{incoming.socket.once('close',released);entered();});const origin=await listen(target);const proxy=await retirementProxy(origin);
 const pending=get(proxy.origin);const failed=expect(pending).rejects.toBeTruthy();
 try{await bounded(called,'No request reached the upstream');await proxy.close();await failed;await bounded(socketClosed,'Upstream did not close');expect(proxy.state().active).toBe(0);expect(proxy.state().failures).toBe(0);}
 finally{await proxy.close();await close(target);}
});

it.each(['cancel','deadline'] as const)('fences %s after the final body chunk before any upstream dispatch',async mode=>{
 let calls=0;const target=createServer((_incoming,response)=>{calls++;response.end('ok');});const origin=await listen(target);
 const incoming=new IncomingMessage(new Socket());incoming.url='/runner/v1/capabilities';incoming.method='GET';const response=new ServerResponse(incoming);
 vi.useFakeTimers({toFake:['performance']});const forwards=new ProxyForwards(new URL(origin),100);
 Reflect.set(incoming,Symbol.asyncIterator,async function*(){yield Buffer.from('body');if(mode==='cancel')void forwards.close();else await vi.advanceTimersByTimeAsync(101);});
 try{
  forwards.handle(incoming,response);
  for(let ticks=0;ticks<32&&forwards.state().active>0;ticks++)await new Promise<void>(resolve=>setImmediate(resolve));
  expect(forwards.state().active).toBe(0);expect(calls).toBe(0);expect(forwards.state().failures).toBe(mode==='deadline'?1:0);await forwards.close();
 }finally{vi.useRealTimers();incoming.destroy();response.destroy();await forwards.close();await close(target);}
});
