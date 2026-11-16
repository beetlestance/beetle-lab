import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import type {IncomingMessage,ServerResponse,ClientRequest,IncomingHttpHeaders} from 'node:http';
import {dirname} from 'node:path';
import type {Socket} from 'node:net';
import {writeFile,lstat} from 'node:fs/promises';
interface Options{readonly socketPath:string;readonly upstreamSocketPath:string;readonly markerPath:string;readonly installationId:string;readonly runtimeId:string;readonly runtimeName:string}
interface Work{readonly input:IncomingMessage;readonly output:ServerResponse;readonly downstreamClosed:Promise<void>;upstream?:ClientRequest;reply?:IncomingMessage;readonly deadline:number;cancelled:boolean;expired:boolean}
/** Manual Linux sidecar only. Forwards real Docker, never produces a fake deletion reply. */
export async function runDockerProxy(options:Options){
 for(const path of [options.socketPath,options.upstreamSocketPath])assert(path.startsWith('/')&&Buffer.byteLength(path)<108);
 assert(/^[a-f0-9-]{36}$/.test(options.installationId));assert(/^[a-f0-9]{64}$/.test(options.runtimeId));assert(/^beetle-[a-f0-9]{64}$/.test(options.runtimeName));
 const sockets=new Map<Socket,Promise<void>>();const work=new Map<Work,Promise<void>>();let seenOriginal=false;let seenVolume=false;
 let stopping=false;let faulted=false;let failures=0;let refused=0;let closing:Promise<void>|undefined;
 const server=createServer((input,output)=>{
  if(stopping||work.size>=8){failures++;output.writeHead(503);output.end();return;}
  const closed=sockets.get(input.socket);if(!closed){failures++;output.destroy();return;}const owner:Work={input,output,downstreamClosed:closed,deadline:performance.now()+30000,cancelled:false,expired:false};
  const abort=()=>{if(!output.writableFinished)owner.cancelled=true;owner.upstream?.destroy();};output.once('close',abort);
  const timer=setTimeout(()=>{owner.expired=true;stop(owner);},30000);const original=forward(owner).catch(()=>{if(owner.expired||!stopping&&!input.aborted&&!owner.cancelled)failures++;output.destroy();})
   .finally(()=>{clearTimeout(timer);output.off('close',abort);work.delete(owner);});work.set(owner,original);
 });
 server.on('connection',socket=>{if(stopping||sockets.size>=16){failures++;socket.destroy();return;}
  sockets.set(socket,new Promise<void>(resolve=>socket.once('close',()=>{sockets.delete(socket);resolve();})));});
 server.headersTimeout=5000;server.requestTimeout=10000;server.maxHeadersCount=32;server.keepAliveTimeout=1000;
 async function forward(owner:Work):Promise<void>{
  const body=await bytes(owner.input,4096);const path=forwardPath(owner,stopping);
  if(!allowed(owner.input.method,path)){refused++;owner.output.writeHead(403);owner.output.end('qualification scope denied');return;}
  const reply=await exchange(owner,path,body,options.upstreamSocketPath);remember(path,reply.body);
  const match=/^\/v1\.47\/containers\/([a-f0-9]{64})\?force=false&v=false$/.exec(path);
  if(owner.input.method==='DELETE'&&match&&reply.status===204&&!faulted){
   assert.equal(match[1],options.runtimeId);faulted=true;
   await writeFile(options.markerPath,JSON.stringify({version:1,installationId:options.installationId,runtimeId:match[1]}),{mode:0o600,flag:'wx'});
   await owner.downstreamClosed;return;
  }
  owner.output.writeHead(reply.status,reply.headers);owner.output.end(reply.body);
 }
 function allowed(method:string|undefined,path:string):boolean{
  if(method==='GET')return path==='/version'||path.startsWith('/v1.47/');if(method!=='DELETE')return false;
  if(path===`/v1.47/containers/${options.runtimeId}?force=false&v=false`)return seenOriginal;
  return path===`/v1.47/volumes/${options.runtimeName}-live?force=false`&&seenVolume;
 }
 function remember(path:string,body:Buffer):void{
  if(body.length===0||!inspectable(path,options.runtimeName))return;const raw:unknown=JSON.parse(body.toString('utf8'));if(!raw||typeof raw!=='object')return;
  seenOriginal=seenOriginal||originalMatches(raw,options);seenVolume=seenVolume||volumeMatches(raw,options);
 }

 const parent=await lstat(dirname(options.socketPath));assert(parent.isDirectory()&&parent.uid===process.getuid?.()&&(parent.mode&0o077)===0);
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.socketPath,resolve);});
 return {state:()=>({active:work.size,sockets:sockets.size,faulted,failures,refused,seenOriginal,seenVolume}),close:()=>closing??=(async()=>{
  stopping=true;const incoming=[...sockets.values()];const stopped=new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  for(const owner of work.keys())stop(owner);for(const socket of sockets.keys())socket.destroy();await Promise.all([...work.values(),stopped,...incoming]);await Promise.all([...sockets.values()]);
  assert.equal(work.size,0);assert.equal(sockets.size,0);
 })()};
}
function stop(owner:Work):void{owner.input.destroy();owner.output.destroy();owner.reply?.destroy();owner.upstream?.destroy();owner.upstream?.socket?.destroy();}
async function exchange(owner:Work,path:string,body:Buffer,socketPath:string):Promise<{status:number;body:Buffer;headers:IncomingHttpHeaders}>{
 const upstream=request({socketPath,path,method:owner.input.method,headers:owner.input.headers,agent:false});owner.upstream=upstream;
 const requestClosed=closed(upstream);let socketClosed=Promise.resolve();let replyClosed=Promise.resolve();upstream.once('socket',socket=>{socketClosed=closed(socket);});
 const abort=()=>upstream.destroy();owner.output.once('close',abort);
 try{const reply=await new Promise<IncomingMessage>((resolve,reject)=>{upstream.once('response',resolve);upstream.once('error',reject);upstream.end(body);});owner.reply=reply;replyClosed=closed(reply);
  return {status:reply.statusCode??502,headers:reply.headers,body:await bytes(reply,2097152)};
 }finally{owner.output.off('close',abort);upstream.destroy();owner.reply?.destroy();await Promise.all([requestClosed,socketClosed,replyClosed]);}
}
function closed(stream:{once(event:'close',listener:()=>void):unknown}):Promise<void>{return new Promise(resolve=>stream.once('close',resolve));}
async function bytes(stream:IncomingMessage,maximum:number):Promise<Buffer>{
 const chunks:Buffer[]=[];let length=0;for await(const input of stream){assert(input instanceof Uint8Array);length+=input.byteLength;assert(length<=maximum&&chunks.length<256);chunks.push(Buffer.from(input));}return Buffer.concat(chunks,length);
}

function originalMatches(raw:object,options:Options):boolean{
 const config=Reflect.get(raw,'Config');const labels=config&&typeof config==='object'?Reflect.get(config,'Labels'):undefined;
 return Boolean(labels&&Reflect.get(labels,'dev.beetle.installation')===options.installationId&&Reflect.get(raw,'Id')===options.runtimeId&&Reflect.get(raw,'Name')===`/${options.runtimeName}`);
}
function volumeMatches(raw:object,options:Options):boolean{
 const labels=Reflect.get(raw,'Labels');return Boolean(labels&&Reflect.get(labels,'dev.beetle.installation')===options.installationId&&Reflect.get(labels,'dev.beetle.purpose')==='live-mailbox'&&Reflect.get(raw,'Name')===`${options.runtimeName}-live`);
}

function forwardPath(owner:Work,stopping:boolean):string{
 assert(!stopping&&!owner.cancelled&&!owner.expired&&!owner.input.aborted&&performance.now()<owner.deadline);const path=owner.input.url;assert(path&&path.length<=1024);return path;
}
function inspectable(path:string,runtimeName:string):boolean{return path.endsWith('/json')&&path.startsWith('/v1.47/containers/')||path===`/v1.47/volumes/${runtimeName}-live`;}
