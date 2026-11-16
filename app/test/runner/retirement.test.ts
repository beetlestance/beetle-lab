import { expect,it,vi } from 'vitest';
import type { OutputRetirementRequest } from '@beetle/contracts';
import type { RetirementRequest,RetirementReply } from '@beetle/contracts/output-retirement';
import { createRunnerGateway } from '../../src/adapters/outbound/runner/index.js';
import { fixture,loopback,send,turns } from './fixtures.js';
import { setup,envelope } from './source-fixtures.js';
const request=()=>fixture<OutputRetirementRequest>('output-retirement-source');
const reply=(state='pending')=>fixture<RetirementReply>(`output-retirement-reply-source-${state}`);
it.each(['pending','cleaned'])('uses the exact original request and authenticated TCP for %s',async state=>{
 let received:unknown;let headers:unknown;let path:unknown;
 const server=await loopback((req,res)=>{const chunks:Buffer[]=[];let bytes=0;headers=req.headers;path=req.url;
  req.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>3072){req.destroy();return;}chunks.push(chunk);});
  req.on('end',()=>{received=JSON.parse(Buffer.concat(chunks).toString());send(res,reply(state));});
 });const gateway=createRunnerGateway(server.loaded);
 try{
  expect(await gateway.retireOutput(request())).toEqual({ok:true,value:reply(state)});expect(received).toEqual(request());
  expect(path).toBe(`/runner/v1/attempts/${request().attemptId}/output-retirement`);
  expect(headers).toMatchObject({authorization:`Bearer ${server.loaded.token}`,'x-beetle-journal-authority':request().journalAuthority,'x-beetle-organization-id':request().organizationId});
 }finally{await gateway.close();await server.close();}
});
it.each(['organizationId','workspaceId','attemptId','journalAuthority','runId','deletionId','intentDigest','requestDigest','pending-closure','closure-change'])('rejects mismatched %s from a valid HTTP response',async field=>{
 const {gateway,native}=setup();const input=request();if(field==='closure-change'&&input.closure.kind==='source')input.closure.sourceDigest='f'.repeat(64);
 const value={...reply()} as Record<string,unknown>;
 if(field==='pending-closure')value.namespaceIdentity='f'.repeat(64);
 else if(field!=='closure-change')value[field]=field.endsWith('Digest')?'f'.repeat(64):'00000000-0000-4000-8000-000000000999';
 const pending=gateway.retireOutput(input);await turns();const work=native.originals[0]!;work.body(value);work.close();
 expect(await pending).toEqual({ok:false,error:{kind:'response',status:200}});
});
it('uses one detached request through held DNS and later caller mutation',async()=>{
 const {gateway,native}=setup(true);const input=request();const captured=JSON.parse(JSON.stringify(input)) as RetirementRequest;
 const pending=gateway.retireOutput(input);input.attemptId='00000000-0000-4000-8000-000000000999';if(input.closure.kind==='source')input.closure.sourceDigest='f'.repeat(64);
 native.releaseDns();await turns();const work=native.originals[0]!;
 expect(JSON.parse(work.request.end.mock.calls[0]![0]!)).toEqual(captured);expect(work.options.path).toContain(captured.attemptId);
 work.body(reply());work.close();expect(await pending).toEqual({ok:true,value:reply()});
});
it('shares source admission and refuses capacity before observing caller request traps',async()=>{
 const {gateway,client,native}=setup(true);const first=gateway.retireOutput(request());const second=client.source();let reads=0;
 const forbidden=new Proxy(request(),{getOwnPropertyDescriptor(){reads++;throw Error('Must refuse before capture');}});
 expect(await gateway.retireOutput(forbidden)).toEqual({ok:false,error:{kind:'transport'}});expect(reads).toBe(0);
 const closing=gateway.close();native.releaseDns();await Promise.all([first,second,closing]);expect(native.io.request).not.toHaveBeenCalled();
});
it.each(['abort','deadline','shutdown'] as const)('retains exact reply and native closes through %s',async stop=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});const {gateway,client,native}=setup();const controller=new AbortController();
 const pending=gateway.retireOutput(request(),controller.signal);const second=client.source();await turns();const work=native.originals[0]!;
 work.body(reply());let settled=false;void pending.then(()=>{settled=true;});let closing:Promise<void>|undefined;
 if(stop==='abort')controller.abort();if(stop==='deadline')await vi.advanceTimersByTimeAsync(5001);if(stop==='shutdown')closing=gateway.close();
 expect(await gateway.retireOutput(request())).toEqual({ok:false,error:{kind:'transport'}});
 work.request.emit('close');work.socket.emit('close');await turns();expect(settled).toBe(false);
 work.response.emit('close');expect(await pending).toEqual({ok:true,value:reply()});
 const other=native.originals[1]!;other.body(envelope());other.close();await second;if(closing)await closing;
});
it('bounds response bytes and retains failed native work through all closes',async()=>{
 const {gateway,native}=setup();const pending=gateway.retireOutput(request());await turns();const work=native.originals[0]!;
 work.body({padding:'x'.repeat(4096)});let settled=false;void pending.then(()=>{settled=true;});await turns();expect(settled).toBe(false);
 work.close();expect((await pending).ok).toBe(false);
});
it.each([201,302,404])('never treats status %s as cleanup completion',async status=>{
 const {gateway,native}=setup();const pending=gateway.retireOutput(request());await turns();const work=native.originals[0]!;
 work.body(reply(),status);work.close();expect((await pending).ok).toBe(false);
});
it('rejects invalid oversized input before DNS and returns cancellation without implying rollback',async()=>{
 const {gateway,native}=setup();const invalid={...request(),padding:'x'.repeat(3072)} as RetirementRequest;
 expect(await gateway.retireOutput(invalid)).toEqual({ok:false,error:{kind:'request'}});expect(native.io.lookup).not.toHaveBeenCalled();
 const controller=new AbortController();const pending=gateway.retireOutput(request(),controller.signal);await turns();const work=native.originals[0]!;
 controller.abort();let settled=false;void pending.then(()=>{settled=true;});await turns();expect(settled).toBe(false);
 work.close();expect(await pending).toEqual({ok:false,error:{kind:'cancelled'}});
});
