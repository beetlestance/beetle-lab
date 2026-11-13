import { EventEmitter } from 'node:events';
import { expect,it } from 'vitest';
import type { ClientRequest,IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { UnixDockerTransport } from '../../../src/backends/docker/index.js';
import type { RequestFactory } from '../../../src/backends/docker/index.js';
class HeldSocket extends EventEmitter {destroyed=false;destroy(){this.destroyed=true;return this;}}
class HeldResponse extends EventEmitter {
 statusCode=200;complete=true;destroyed=false;
 constructor(readonly socket:Socket){super();}destroy(){this.destroyed=true;return this;}
}
class HeldRequest extends EventEmitter {
 destroyed=false;readonly socket=new HeldSocket();readonly response=new HeldResponse(this.socket as unknown as Socket);
 end(){queueMicrotask(()=>{this.emit('socket',this.socket);this.emit('response',this.response);
  this.response.emit('data',Buffer.from('{}'));this.response.emit('end');});}
 destroy(){this.destroyed=true;return this;}
 closeAll(){this.emit('close');this.response.emit('close');this.socket.emit('close');}
}
function fixture(){
 const calls:HeldRequest[]=[];const factory=(()=>{const request=new HeldRequest();calls.push(request);return request as unknown as ClientRequest;}) as RequestFactory;
 const transport=new UnixDockerTransport('/tmp/task-owned-held-docker.sock',factory);
 return{calls,transport,call:(signal?:AbortSignal)=>transport.request({method:'GET',path:'/version',deadline:performance.now()+10000,...(signal?{signal}:{})})};
}
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
it('retains the actual request, response and socket separately after the response is complete',async()=>{
 const f=fixture();let done=false;const pending=f.call().then(value=>{done=true;return value;});await turn();
 const original=f.calls[0]!;expect(original.destroyed).toBe(true);expect(original.response.destroyed).toBe(true);
 original.emit('close');await turn();expect(done).toBe(false);
 original.response.emit('close');await turn();expect(done).toBe(false);
 original.socket.emit('close');expect(await pending).toEqual({ok:true,status:200,body:{}});
});
it('keeps capacity charged until actual close and rechecks cancellation after a held close',async()=>{
 const f=fixture();const controller=new AbortController();const first=f.call(controller.signal);
 const rest=Array.from({length:63},()=>f.call());await turn();
 expect(await f.call()).toEqual({ok:false,reason:'overflow',dispatched:false});expect(f.calls).toHaveLength(64);
 controller.abort();await turn();expect(f.calls[0]!.socket.destroyed).toBe(true);
 for(const request of f.calls)request.closeAll();expect(await first).toEqual({ok:false,reason:'aborted',dispatched:true});
 await Promise.all(rest);const replay=f.call();await turn();f.calls.at(-1)!.closeAll();expect(await replay).toMatchObject({ok:true});
});
it('owns a late response after abort until all of its originals actually close',async()=>{
 const controller=new AbortController();let request!:HeldRequest;
 const factory=(()=>{request=new HeldRequest();request.end=()=>{};return request as unknown as ClientRequest;}) as RequestFactory;
 const transport=new UnixDockerTransport('/tmp/task-owned-late-docker.sock',factory);let done=false;
 const pending=transport.request({method:'GET',path:'/version',deadline:performance.now()+10000,signal:controller.signal}).then(value=>{done=true;return value;});
 controller.abort();request.emit('response',request.response as unknown as IncomingMessage);
 request.emit('close');request.socket.emit('close');await turn();expect(done).toBe(false);expect(request.response.destroyed).toBe(true);
 request.response.emit('close');expect(await pending).toEqual({ok:false,reason:'aborted',dispatched:true});
});
