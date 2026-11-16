import {createHash} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {createStandaloneExportAssignment} from '@beetle/contracts';
import type {AttemptSnapshot} from '@beetle/contracts';
import source from '../../../contracts/fixtures/export-v1/assignment.json' with {type:'json'};
import {createRunnerGateway} from '../../src/adapters/outbound/runner/index.js';
import {openGateway} from '../../src/adapters/outbound/runner/gateway.js';
import {loopback,send,deferred,turns,loaded} from './fixtures.js';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function assignment(){const {assignmentDigest:unused,...body}=structuredClone(source);void unused;
 return createStandaloneExportAssignment({...body,version:1,purpose:'standalone_export',offer:{...body.offer,protocolVersion:'1.0',
  config:{payload:'界'.repeat(230000)}}},hash);}
function identity(value:ReturnType<typeof assignment>){const offer=value.offer;return {journalAuthority:'33333333-3333-4333-8333-333333333333',
 organizationId:offer.organizationId,workspaceId:offer.workspaceId,attemptId:offer.attemptId,generation:1,intentDigest:offer.intentDigest};}
it('sends a large exact purpose assignment on its fixed route and rejects mismatched identity before network effects',async()=>{
 const value=assignment();const own=identity(value);const snapshot:AttemptSnapshot={protocolVersion:'1.0',...own,state:'offered',
 lastSeq:0,retainedStartSeq:0,cancelRequested:false};Reflect.deleteProperty(snapshot,'journalAuthority');
 const received:{path:string;body:unknown}[]=[];
 const peer=await loopback((request,response)=>{const parts:Buffer[]=[];let bytes=0;
 request.on('data',(part:Buffer)=>{bytes+=part.length;if(bytes>2105344){request.destroy();return;}parts.push(part);});
 request.on('end',()=>{received.push({path:request.url!,body:JSON.parse(Buffer.concat(parts).toString())});send(response,snapshot,202);});});
 const gateway=createRunnerGateway(peer.loaded);
 try{
  expect((await gateway.exportAttempt(own).offerExport(value)).ok).toBe(true);
  expect(received).toEqual([{path:'/runner/v1/attempts/'+own.attemptId+'/export',body:value}]);
  expect(Buffer.byteLength(JSON.stringify(value))).toBeGreaterThan(65536);
  const wrong=gateway.exportAttempt({...own,workspaceId:'00000000-0000-4000-8000-000000000099'});
  expect(await wrong.offerExport(value)).toMatchObject({ok:false,error:{kind:'request'}});expect(received).toHaveLength(1);
 }finally{await gateway.close();await peer.close();}
});
it('shares two large-original credits across performance, export and cancellation until original DNS settles',async()=>{
 const dns=deferred<readonly {address:string;family:number}[]>();const request=vi.fn();const lookup=vi.fn(()=>dns.promise);
 const gateway=openGateway(loaded(),{lookup,request});const value=assignment();const own=identity(value);
 const performance=gateway.attempt(own).offer({...value.offer,requiredCapabilities:[]});
 const exported=gateway.exportAttempt(own).offerExport(value);
 expect(await gateway.exportAttempt(own).cancelExportOriginal(value)).toMatchObject({ok:false,error:{kind:'transport'}});
 expect(lookup).toHaveBeenCalledTimes(2);let closed=false;const closing=gateway.close().then(()=>{closed=true;});await turns();expect(closed).toBe(false);
 dns.resolve([]);await Promise.all([performance,exported,closing]);expect(request).not.toHaveBeenCalled();expect(closed).toBe(true);
});
