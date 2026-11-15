import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createApiClient} from '@beetle/contracts/api';
import type {ApiClient,ApiClientFailure,ApiClientResult,BrowserSession,ExportJob,ExportParams} from '@beetle/contracts/api';
import {pause,value} from '../public-api.js';
export const hash=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
/** Same-origin public TCP; cookie/CSRF are retained in memory, never evidence output. */
export async function automaticSession(origin:string){
 let cookie='';let requests=0;
 const fetcher:typeof fetch=async(input,init)=>{
  const url=new URL(String(input));assert(url.origin===origin&&url.pathname.startsWith('/api/v2/')&&++requests<=256);
  const headers=new Headers(init?.headers);headers.set('origin',origin);if(cookie)headers.set('cookie',cookie);
  const response=await fetch(url,{...init,headers,redirect:'error'});const received=response.headers.get('set-cookie');
  if(received){assert(received.length<=4096);cookie=received.split(';')[0]!;}return response;
 };
 const options={baseUrl:origin,fetch:fetcher,maximumBytes:1048576,timeoutMs:2000};const initial=createApiClient(options);
 const prior=await readReadyPublic<BrowserSession|null>(async signal=>{
  const result=await initial.getBrowserSession({signal});return !result.ok&&result.error.protocol?.code==='unpaired'?{ok:true,value:null}:result;
 });
 const session=prior??value(await createApiClient({...options,headers:{'X-Beetle-Local':'1'}}).openLocalBrowserSession({body:{}}));assert(cookie);
 const api=createApiClient({...options,headers:{'X-Beetle-CSRF':session.csrfToken}});
 return {api,session,requests:()=>requests,cookieDigest:()=>hash(cookie),content:(path:string,headers:Record<string,string>={},signal?:AbortSignal)=>
  fetcher(new URL(path,origin),{headers,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000)})};
}
export async function automaticClient(origin: string) {
 const client = await automaticSession(origin); const installation = await readReadyPublic(signal => client.api.getInstallationSettings({signal}));
 return {...client, installation};
}
function transientRead(error:ApiClientFailure):boolean{
 if(error.kind==='transport'||error.kind==='timeout')return true;
 if(error.kind==='protocol')return error.protocol?.retryable===true&&typeof error.status==='number'&&error.status>=500&&error.status<600;
 return error.kind==='response'&&[502,503,504].includes(error.status??0);
}
/** Trusted composition supplies GET operations only; never retry a mutation. */
export async function readReadyPublic<T>(read:(signal:AbortSignal)=>Promise<ApiClientResult<T>>):Promise<T>{
 const deadline=performance.now()+45000;
 const signal=AbortSignal.timeout(45000);
 for(let n=0;n<100&&performance.now()<deadline;n++){
  const result=await read(signal);if(signal.aborted||performance.now()>=deadline)throw Error('Public readiness deadline');
  if(result.ok)return result.value;
  assert(transientRead(result.error),`Unexpected authenticated readiness refusal: ${result.error.status??0}/${result.error.kind}`);await pause();
 }throw Error('Public readiness deadline');
}
export async function exportReady(api:ApiClient,params:ExportParams):Promise<ExportJob>{
 const deadline=performance.now()+60000;
 for(let calls=0;calls<160&&performance.now()<deadline;calls++){
  const job=value(await api.getExport({params}));if(['ready','failed','cancelled'].includes(job.state)){assert.equal(job.state,'ready',job.reason??job.state);return job;}await pause();
 }throw Error('Public export deadline');
}
export async function readContent(response:Response,maximum:number):Promise<Buffer>{
 if(response.status!==200)value({ok:false,error:{kind:'response',status:response.status}});
 assert(response.body);const reader=response.body.getReader();const chunks:Buffer[]=[];let bytes=0;
 for(let calls=0;calls<256;calls++){const part=await reader.read();if(part.done)return Buffer.concat(chunks,bytes);
  bytes+=part.value.length;if(bytes>maximum){await reader.cancel();throw Error('Content bound');}chunks.push(Buffer.from(part.value));}
 await reader.cancel();throw Error('Content fragment bound');
}
