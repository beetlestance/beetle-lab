import assert from 'node:assert/strict';
import {request} from 'node:http';
import type {IncomingMessage,ClientRequest} from 'node:http';
/** A real unread HTTP body. Only one exact armed content request is intercepted. */
export function slowTransport(origin:string){
 let path:string|undefined;let incoming:IncomingMessage|undefined;let outgoing:ClientRequest|undefined;
 let requestClosed=false;let responseClosed=false;
 let closed:Promise<void>|undefined;let finish:(()=>void)|undefined;let failure:unknown;let status:number|undefined;let abort:()=>void=()=>undefined;
 const finishIfClosed=()=>{if(requestClosed&&(!incoming||responseClosed))finish?.();};
 const fetcher:typeof fetch=async(input,init)=>{
  const url=new URL(String(input));assert.equal(url.origin,origin);
  if(path===undefined||url.pathname!==path)return fetch(input,init);
  assert(!outgoing&&init?.method==='GET');closed=new Promise(resolve=>{finish=resolve;});const signal=init.signal;
  return new Promise<Response>((resolve,reject)=>{
   outgoing=request(url,{method:'GET',headers:Object.fromEntries(new Headers(init.headers)),agent:false},response=>{
    incoming=response;status=response.statusCode;response.pause();
    response.once('close',()=>{responseClosed=true;signal?.removeEventListener('abort',abort);finishIfClosed();});
    response.once('error',error=>{failure=error;});
    try{
     assert.equal(response.statusCode,200);const headers=new Headers();
     for(const [name,value] of Object.entries(response.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(','):value);
     resolve(new Response(new ReadableStream({cancel:async()=>{abort();await closed;}},{highWaterMark:0}),{status:200,headers}));
    }catch(error){reject(error);abort();}
   });
   abort=()=>{outgoing!.destroy();incoming?.destroy();};
   outgoing.once('error',error=>{if(!incoming)reject(error);else failure=error;});
   outgoing.once('close',()=>{requestClosed=true;if(!incoming){signal?.removeEventListener('abort',abort);reject(Error('Slow request closed before headers'));}finishIfClosed();});
   outgoing.setTimeout(8000,abort);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();outgoing.end();
  });
 };
 return {fetch:fetcher,arm(contentPath:string){assert(!path&&contentPath.startsWith('/api/v2/'));path=contentPath;},
  state(){return {status,bufferedBytes:incoming?.readableLength??0,complete:incoming?.complete??false,ended:incoming?.readableEnded??false,destroyed:incoming?.destroyed??false};},
  async close(){abort();if(closed)await closed;return {failure:failure instanceof Error?failure.name:null};}};
}
