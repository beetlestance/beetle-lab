import type { ClientRequest,IncomingMessage,request as httpRequest } from 'node:http';
import type { Socket } from 'node:net';
import { performance } from 'node:perf_hooks';
import type { DockerRequest,DockerReply,FailureReason } from './types.js';
interface Options{
 readonly socketPath:string;readonly input:DockerRequest;readonly body:string;readonly remaining:number;readonly factory:typeof httpRequest;
 consume(response:IncomingMessage,finish:(reply:DockerReply)=>void,fail:(reason:FailureReason)=>void):void;
}
/** Completion retains the bounded slot through actual request, response and socket close. */
export function exchangeDockerOriginal(options:Options):Promise<DockerReply>{return new Original(options).run();}
class Original{
 private request:ClientRequest|undefined;private response:IncomingMessage|undefined;
 private requestClosed=false;private responseClosed=true;private issuing=false;private dispatched=false;
 private readonly sockets=new Map<Socket,boolean>();private uncertain=false;private settled=false;
 private decision:DockerReply|undefined;private timer:ReturnType<typeof setTimeout>|undefined;
 private resolve!:(reply:DockerReply)=>void;
 private readonly completion=new Promise<DockerReply>(resolve=>{this.resolve=resolve;});
 private readonly abort=()=>this.fail('aborted');
 constructor(private readonly options:Options){}
 run():Promise<DockerReply>{
  const{input,factory,socketPath,remaining,body}=this.options;
  this.timer=setTimeout(()=>this.fail('deadline'),remaining);input.signal?.addEventListener('abort',this.abort,{once:true});
  this.issuing=true;
  try{
   this.request=factory({socketPath,method:input.method,path:input.path,agent:false,maxHeaderSize:16384,
    headers:{'content-type':'application/json','content-length':Buffer.byteLength(body)}});
   this.request.on('close',()=>{this.requestClosed=true;if(!this.decision)this.fail('unavailable');this.finish();});
   this.request.on('error',()=>this.fail('unavailable'));
   this.request.on('socket',socket=>this.socket(socket));
   this.request.on('response',response=>this.receive(response));
   if(this.request.socket)this.socket(this.request.socket);
   this.issuing=false;this.dispatch(body);
  }catch{this.issuing=false;this.fail('unavailable');}
  return this.completion;
 }
 private dispatch(body:string):void{
  if(this.options.input.signal?.aborted){this.fail('aborted');return;}
  if(this.decision){this.destroy();this.finish();return;}
  if(performance.now()>=this.options.input.deadline){this.fail('deadline');return;}
  this.dispatched=true;this.request!.end(body);
 }
 private socket(socket:Socket):void{
  if(this.sockets.has(socket))return;
  // Node exposes request and response socket originals; a third is an invalid factory.
  if(this.sockets.size>=2){this.uncertain=true;socket.on('error',()=>{});socket.destroy();this.fail('unavailable');return;}
  this.sockets.set(socket,false);
  socket.on('close',()=>{this.sockets.set(socket,true);this.finish();});
  socket.on('error',()=>this.fail('unavailable'));
  if(this.decision)socket.destroy();
 }
 private receive(response:IncomingMessage):void{
  if(this.response){this.uncertain=true;response.on('error',()=>{});response.destroy();this.fail('unavailable');return;}
  this.response=response;this.responseClosed=false;
  response.on('close',()=>{this.responseClosed=true;if(!this.decision)this.fail('unavailable');this.finish();});
  if(response.socket)this.socket(response.socket);
  if(this.decision){response.destroy();return;}
  this.options.consume(response,reply=>this.decide(reply),reason=>this.fail(reason));
 }
 private decide(reply:DockerReply):void{
  if(this.settled)return;if(!this.decision)this.decision=reply;
  this.destroy();this.finish();
 }
 private fail(reason:FailureReason):void{this.decide({ok:false,reason,dispatched:this.dispatched});}
 private destroy():void{
  this.response?.destroy();this.request?.destroy();for(const socket of this.sockets.keys())socket.destroy();
 }
 private quiescent():boolean{
  return !this.issuing&&!this.uncertain&&(!this.request||this.requestClosed)&&this.responseClosed
   &&[...this.sockets.values()].every(closed=>closed);
 }
 private finish():void{
  if(this.settled||!this.decision||!this.quiescent())return;
  let reply=this.decision;const{input}=this.options;
  if(input.signal?.aborted)reply={ok:false,reason:'aborted',dispatched:this.dispatched};
  else if(performance.now()>=input.deadline)reply={ok:false,reason:'deadline',dispatched:this.dispatched};
  this.settled=true;clearTimeout(this.timer);input.signal?.removeEventListener('abort',this.abort);this.resolve(reply);
 }
}
