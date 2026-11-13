import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {request} from 'node:http';
import type {ClientRequest,IncomingMessage,ServerResponse} from 'node:http';
import {encodeCanonicalJson} from '@beetle/contracts';
import {captureOutputRetirementReply} from '@beetle/contracts/output-retirement';
interface Owner{readonly incoming:IncomingMessage;readonly response:ServerResponse;request?:ClientRequest;reply?:IncomingMessage;cancelled:boolean;expired:boolean;readonly deadline:number}
/** One bounded TCP forward owns request, response and actual socket close. */
export class ProxyForwards{
 private readonly owners=new Map<Owner,Promise<void>>();private closing=false;
 private calls=0;private cleaned=0;private dropped=false;private failures=0;private cleanedDigest:string|null=null;
 constructor(private readonly origin:URL,private readonly operationMs:number){}
 state(){return {active:this.owners.size,retirementCalls:this.calls,cleanedReplies:this.cleaned,dropped:this.dropped,failures:this.failures,cleanedDigest:this.cleanedDigest};}
 refuse():void{this.failures++;}
 handle(incoming:IncomingMessage,response:ServerResponse):void{
  if(this.closing||this.owners.size>=8){this.refuse();response.writeHead(503);response.end();return;}
  const owner:Owner={incoming,response,cancelled:false,expired:false,deadline:performance.now()+this.operationMs};const abort=()=>{if(!response.writableFinished)owner.cancelled=true;owner.request?.destroy();};response.once('close',abort);
  const timer=setTimeout(()=>{owner.expired=true;this.stop(owner);},this.operationMs);
  const original=this.forward(owner).catch(()=>{if(owner.expired||!this.closing&&!owner.cancelled&&!incoming.aborted)this.failures++;response.destroy();}).finally(()=>{clearTimeout(timer);response.off('close',abort);this.owners.delete(owner);});
  this.owners.set(owner,original);
 }
 private async forward(owner:Owner):Promise<void>{
  const path=owner.incoming.url;assert(path?.startsWith('/runner/v1/'));const body=await bytes(owner.incoming,3072);this.check(owner);
  const retirement=owner.incoming.method==='POST'&&path!.endsWith('/output-retirement');if(retirement)this.calls++;
  const upstream=request(new URL(path!,this.origin),{method:owner.incoming.method,headers:owner.incoming.headers,agent:false});owner.request=upstream;
  const requestClosed=closed(upstream);let socketClosed=Promise.resolve();let replyClosed=Promise.resolve();
  upstream.once('socket',socket=>{socketClosed=closed(socket);});
  const abort=()=>upstream.destroy();owner.response.once('close',abort);
  try{
   const reply=await new Promise<IncomingMessage>((resolve,reject)=>{upstream.once('response',resolve);upstream.once('error',reject);upstream.end(body);});
   owner.reply=reply;replyClosed=closed(reply);const value=await bytes(reply,retirement?4096:1048576);
   if(retirement&&this.drop(body,value)){owner.response.destroy();return;}
   owner.response.writeHead(reply.statusCode??502,reply.headers);owner.response.end(value);
  }finally{owner.response.off('close',abort);upstream.destroy();owner.reply?.destroy();await Promise.all([requestClosed,socketClosed,replyClosed]);}
 }
 private check(owner:Owner):void{if(performance.now()>=owner.deadline)owner.expired=true;assert(!this.closing&&!owner.cancelled&&!owner.expired,'Proxy interrupted before dispatch');}
 private drop(requestBody:Buffer,replyBody:Buffer):boolean{
  const value:unknown=JSON.parse(replyBody.toString('utf8'));if(!value||typeof value!=='object'||Reflect.get(value,'state')!=='cleaned')return false;
  const hash=(text:string)=>createHash('sha256').update(text).digest('hex');const reply=captureOutputRetirementReply(value,JSON.parse(requestBody.toString('utf8')) as unknown,hash);
  const digest=hash(encodeCanonicalJson(reply,4096));if(this.cleanedDigest!==null)assert.equal(digest,this.cleanedDigest);this.cleanedDigest=digest;
  this.cleaned++;if(this.dropped)return false;this.dropped=true;return true;
 }
 private stop(owner:Owner):void{owner.incoming.destroy();owner.response.destroy();owner.reply?.destroy();owner.request?.destroy();owner.request?.socket?.destroy();}
 async close():Promise<void>{this.closing=true;for(const owner of this.owners.keys())this.stop(owner);await Promise.all([...this.owners.values()]);assert.equal(this.owners.size,0);}
}
function closed(stream:{destroyed:boolean;once(event:'close',listener:()=>void):unknown}):Promise<void>{
 // Install before destroy; destroyed alone does not prove the close event occurred.
 return new Promise(resolve=>stream.once('close',resolve));
}
async function bytes(stream:IncomingMessage,maximum:number):Promise<Buffer>{
 const chunks:Buffer[]=[];let length=0;
 for await(const input of stream){assert(input instanceof Uint8Array);length+=input.byteLength;assert(length<=maximum&&chunks.length<256);chunks.push(Buffer.from(input));}
 return Buffer.concat(chunks,length);
}
