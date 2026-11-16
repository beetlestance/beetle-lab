import {expect,it} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import type {ServerResponse} from 'node:http';
import {slowTransport} from './slow.js';
async function server(handler:(response:ServerResponse)=>void){
 const http=createServer((_request,response)=>handler(response));http.listen(0,'127.0.0.1');await once(http,'listening');const address=http.address();if(!address||typeof address==='string')throw Error('Fixture address');
 return {origin:`http://127.0.0.1:${address.port}`,async close(){http.closeAllConnections();await new Promise<void>((resolve,reject)=>http.close(error=>error?reject(error):resolve()));}};
}
it('holds an unread real TCP response and joins the original socket on close',async()=>{
 let markClosed!:()=>void;const closed=new Promise<void>(resolve=>{markClosed=resolve;});const peer=await server(response=>{response.once('close',markClosed);response.write(Buffer.alloc(16384,1));});
 const transport=slowTransport(peer.origin);transport.arm('/api/v2/content');
 try{
  const response=await transport.fetch(peer.origin+'/api/v2/content',{method:'GET'});expect(response.status).toBe(200);
  expect(transport.state()).toMatchObject({complete:false,ended:false,destroyed:false});expect(transport.state().bufferedBytes).toBeLessThanOrEqual(65536);
  await transport.close();await response.body!.cancel();await closed;
 }finally{await transport.close();await peer.close();}
});
it('rejects and settles an aborted original before any headers arrive',async()=>{
 const peer=await server(()=>undefined);const transport=slowTransport(peer.origin);transport.arm('/api/v2/content');
 try{await expect(transport.fetch(peer.origin+'/api/v2/content',{method:'GET',signal:AbortSignal.timeout(20)})).rejects.toThrow();await transport.close();}
 finally{await transport.close();await peer.close();}
});
