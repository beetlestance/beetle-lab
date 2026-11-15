import {validateApi} from '@beetle/contracts/api';
import {value} from '../public-api.js';
import {readReadyPublic} from './public.js';
function capacityBody(parts:readonly Uint8Array[]){
 try{const checked=validateApi('ApiError',JSON.parse(Buffer.concat(parts).toString('utf8')));
  return checked.ok&&checked.value.code==='capacity_unavailable'&&checked.value.retryable?checked.value:null;
 }catch{return null;}
}
async function capacity(response:Response){
 if(response.status!==503||response.headers.get('content-type')?.split(';')[0]?.toLowerCase()!=='application/json'||!response.body)return null;
 const reader=response.body.getReader();const parts:Uint8Array[]=[];let bytes=0;
 try{
  for(let reads=0;reads<64;reads++){
   const part=await reader.read();if(part.done){
    return capacityBody(parts);
   }
   bytes+=part.value.byteLength;if(bytes>4096)return null;parts.push(part.value);
  }return null;
 }finally{try{await reader.cancel();}finally{reader.releaseLock();}}
}
/** GET only: respect an explicit validated capacity refusal; never retry auth/conflict or mutations. */
export async function readyContent(get:(signal:AbortSignal)=>Promise<Response>):Promise<Response>{
 return readReadyPublic(async signal=>{
  const response=await get(signal);if(response.status===200)return {ok:true as const,value:response};
  const protocol=await capacity(response);
  if(protocol)return {ok:false as const,error:{kind:'protocol' as const,status:503,protocol}};
  if(response.body&&!response.body.locked&&!response.bodyUsed)await response.body.cancel();
  return value<never>({ok:false,error:{kind:'response',status:response.status}});
 });
}
