import {expect,it,vi} from 'vitest';
import type {ClientResult,AttemptSnapshot} from '@beetle/contracts';
import type {ExportRuntimeOptions} from '../../src/application/export-runtime/index.js';
import {startExportRuntime} from '../../src/application/export-runtime/index.js';
import {storageFixture,seed,scope} from '../storage/fixture.js';
import {createSuite,append,request} from '../storage/suites-fixture.js';
import {options,createCommand} from './fixture.js';
const f=storageFixture();
async function setup(){
 const metadata=await f.open(f.path(),options());await seed(metadata);const body=request();body.config.secrets=[];
 const revision=await append(metadata,await createSuite(metadata),60,body);const job=await metadata.exports.create(createCommand(revision.id));
 return {metadata,key:{scope,id:job.id}};
}
const wait=async(check:()=>Promise<boolean>)=>{for(let i=0;i<100;i++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Fixture wait exceeded');};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return {promise,resolve};}
it('replays the same original after lost acceptance, then polls without reloading the large assignment',async()=>{
 const e=await setup();const assignments:unknown[]=[];const original=vi.fn(e.metadata.exportExecutions.original);
 let snapshots=0;const failures:unknown[]=[];
 const offer:ExportRuntimeOptions['gateway']['exportAttempt']=()=>({
  offerExport:async body=>{assignments.push(body);if(assignments.length===1)return {ok:false,error:{kind:'transport'}};
   return {ok:true,value:{protocolVersion:'1.0',organizationId:body.offer.organizationId,workspaceId:body.offer.workspaceId,attemptId:body.offer.attemptId,generation:1,intentDigest:body.offer.intentDigest,state:'preparing',phase:'prepare',lastSeq:1,retainedStartSeq:1,cancelRequested:false,admission:{state:'charged'}} as AttemptSnapshot};},
  cancelExportOriginal:async()=>{throw Error('Unexpected cancellation');},
  snapshot:async()=>{snapshots++;return {ok:false,error:{kind:'transport'}};},
  events:async()=>{throw Error('Unexpected events');},ack:async()=>{throw Error('Unexpected ack');},
 });
 const runtime=startExportRuntime({executions:{...e.metadata.exportExecutions,original},outputs:e.metadata.exportOutputs,
  gateway:{exportAttempt:offer,output:()=>{throw Error('Unexpected output');}},transfers:{transfer:()=>{throw Error('Unexpected transfer');},close:async()=>{}},
  intervalMs:25,onFailure:async error=>{failures.push(error);}});
 try{await wait(async()=>snapshots>0);expect(assignments).toHaveLength(2);expect(assignments[0]).toEqual(assignments[1]);
  expect(original).toHaveBeenCalledTimes(2);expect(failures).toEqual([]);expect((await e.metadata.exportExecutions.control(e.key)).acknowledged).toBe(true);
 }finally{await runtime.close();}
});
it('fences synchronously and retains an aborted original until its actual transport settles',async()=>{
 const e=await setup();const pending=deferred<ClientResult<AttemptSnapshot>>();let called=false;let aborted=false;
 const runtime=startExportRuntime({executions:e.metadata.exportExecutions,outputs:e.metadata.exportOutputs,
  gateway:{exportAttempt:()=>({offerExport:async(_body,signal)=>{called=true;signal?.addEventListener('abort',()=>{aborted=true;});return pending.promise;},
   cancelExportOriginal:async()=>{throw Error('Unexpected');},snapshot:async()=>{throw Error('Unexpected');},events:async()=>{throw Error('Unexpected');},ack:async()=>{throw Error('Unexpected');}}),
   output:()=>{throw Error('Unexpected');}},transfers:{transfer:()=>{throw Error('Unexpected');},close:async()=>{}},intervalMs:25,onFailure:async()=>{throw Error('Unexpected failure');}});
 await wait(async()=>called);let closed=false;const close=runtime.close().then(()=>{closed=true;});
 expect(aborted).toBe(true);await Promise.resolve();expect(closed).toBe(false);
 pending.resolve({ok:false,error:{kind:'cancelled'}});await close;
 expect(await e.metadata.exportExecutions.control(e.key)).toMatchObject({possibleDelivery:true,acknowledged:false,state:'dispatching'});
});
