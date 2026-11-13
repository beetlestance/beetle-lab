import { expect,it,vi } from 'vitest';
import type { SettlementRequest,SettlementReply } from '@beetle/contracts/output-settlement';
import { createRunnerGateway } from '../../src/adapters/outbound/runner/index.js';
import { fixture,loopback,send,turns } from './fixtures.js';
import { setup,envelope } from './source-fixtures.js';
const request=()=>fixture<SettlementRequest>('output-settlement-request');
const reply=()=>fixture<SettlementReply>('output-settlement-reply');
it('sends the exact authenticated settlement instruction over real TCP',async()=>{
 let received:unknown;let headers:unknown;let path:unknown;
 const server=await loopback((req,res)=>{const chunks:Buffer[]=[];let bytes=0;headers=req.headers;path=req.url;
  req.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>3584){req.destroy();return;}chunks.push(chunk);});
  req.on('end',()=>{received=JSON.parse(Buffer.concat(chunks).toString());send(res,reply());});
 });const gateway=createRunnerGateway(server.loaded);
 try{
  expect(await gateway.settleOutput(request())).toEqual({ok:true,value:reply()});expect(received).toEqual(request());
  expect(path).toBe(`/runner/v1/attempts/${request().retirement.attemptId}/output-settlement`);
  expect(headers).toMatchObject({authorization:`Bearer ${server.loaded.token}`,'x-beetle-journal-authority':request().retirement.journalAuthority});
 }finally{await gateway.close();await server.close();}
});
it.each(['requestDigest','cleanupReplyDigest','chargedBytes'] as const)('refuses invalid %s',async field=>{
 const {gateway,native}=setup();const value={...reply(),[field]:field==='chargedBytes'?0:'f'.repeat(64)};
 const pending=gateway.settleOutput(request());await turns();const work=native.originals[0]!;work.body(value);work.close();
 expect(await pending).toMatchObject({ok:false,error:{kind:'response'}});
});
it('captures before held DNS and refuses source capacity before caller traps',async()=>{
 const {gateway,client,native}=setup(true);const input={...request(),retirement:{...request().retirement}};const before=structuredClone(input);const pending=gateway.settleOutput(input);
 input.retirement.attemptId='00000000-0000-4000-8000-000000000999';const second=client.source();let reads=0;
 const trapped=new Proxy(request(),{getOwnPropertyDescriptor(){reads++;throw Error('unexpected input read');}});
 expect(await gateway.settleOutput(trapped)).toEqual({ok:false,error:{kind:'transport'}});expect(reads).toBe(0);
 native.releaseDns();await turns();const work=native.originals[0]!;expect(JSON.parse(work.request.end.mock.calls[0]![0]!)).toEqual(before);
 work.body(reply());work.close();expect((await pending).ok).toBe(true);const other=native.originals[1]!;other.body(envelope());other.close();await second;
});
it.each(['abort','deadline','shutdown'] as const)('keeps actual reply and I/O closes owned through %s',async kind=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});const {gateway,native}=setup();const abort=new AbortController();
 const pending=gateway.settleOutput(request(),abort.signal);await turns();const work=native.originals[0]!;work.body(reply());let done=false;void pending.then(()=>{done=true;});
 let closing:Promise<void>|undefined;if(kind==='abort')abort.abort();if(kind==='deadline')await vi.advanceTimersByTimeAsync(5001);if(kind==='shutdown')closing=gateway.close();
 work.request.emit('close');work.socket.emit('close');await turns();expect(done).toBe(false);work.response.emit('close');
 expect(await pending).toEqual({ok:true,value:reply()});if(closing)await closing;
});
it.each([201,302,404])('never treats HTTP%s as a settled reply',async status=>{
 const {gateway,native}=setup();const pending=gateway.settleOutput(request());await turns();const work=native.originals[0]!;work.body(reply(),status);work.close();expect((await pending).ok).toBe(false);
});
it('bounds oversized requests and responses without abandoning failed originals',async()=>{
 const {gateway,native}=setup();expect((await gateway.settleOutput({...request(),padding:'x'.repeat(3584)} as SettlementRequest)).ok).toBe(false);
 expect(native.io.lookup).not.toHaveBeenCalled();const pending=gateway.settleOutput(request());await turns();const work=native.originals[0]!;
 work.body({padding:'x'.repeat(513)});let done=false;void pending.then(()=>{done=true;});await turns();expect(done).toBe(false);work.close();expect((await pending).ok).toBe(false);
});
