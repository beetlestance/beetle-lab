import {expect,it,vi} from 'vitest';
import {Worker} from 'node:worker_threads';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {openMetadata} from '../../../src/adapters/outbound/sqlite/index.js';
import {settingsFixture} from '../../storage/fixture.js';
import {fixture as sourceFixture,cleaned} from '../cleanup-ack/fixture.js';
import {fixture as deletionFixture} from '../../output-deletion-runtime/fixture.js';
import {fixture as parentFixture} from '../../output-runtime/fixture.js';
import {startOutputDeletionRuntime} from '../../../src/application/output-deletion-runtime/index.js';
it.each(['scan','ack'] as const)('retains the actual failed worker carrier through %s rejection and abort',async operation=>{
 const source=sourceFixture();
 const root=await mkdtemp(join(tmpdir(),'beetle-retirement-carrier-'));const file=join(root,'held.mjs');
 await writeFile(file,"import {parentPort} from 'node:worker_threads';parentPort.postMessage({kind:'ready'});parentPort.on('message',()=>{});\n");
 const metadata=await openMetadata({path:join(root,'owned.sqlite'),workerUrl:pathToFileURL(file),installation:settingsFixture().chain.installation,runtime:null});
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const native=Worker.prototype.terminate;
 const terminate=vi.spyOn(Worker.prototype,'terminate').mockImplementation(function(this:Worker){return native.call(this).then(async exit=>{await gate;return exit;});});
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});let settled=false;
 const call=operation==='scan'?metadata.outputDeletions.scanRetirements({limit:1}):metadata.outputDeletions.recordCleanupAck({key:source.key,reply:cleaned(source.request())});
 const pending=call.finally(()=>{settled=true;});const rejected=expect(pending).rejects.toMatchObject({code:'unavailable'});
 try{
  await vi.advanceTimersByTimeAsync(5000);expect(terminate).toHaveBeenCalledTimes(1);expect(settled).toBe(false);
  let stopped=false;const closing=metadata.abort().then(()=>{stopped=true;});await Promise.resolve();expect(stopped).toBe(false);
  release();await rejected;await closing;expect(settled).toBe(true);expect(terminate).toHaveBeenCalledTimes(1);
 }finally{release();vi.useRealTimers();await metadata.abort();terminate.mockRestore();await rm(root,{recursive:true,force:true});}
});
it.each(['held','rejected'] as const)('prevents parent native close through %s cleanup worker termination',async mode=>{
 const root=await mkdtemp(join(tmpdir(),'beetle-retirement-parent-carrier-'));const file=join(root,'held.mjs');
 await writeFile(file,"import {parentPort} from 'node:worker_threads';parentPort.postMessage({kind:'ready'});parentPort.on('message',()=>{});\n");
 const metadata=await openMetadata({path:join(root,'owned.sqlite'),workerUrl:pathToFileURL(file),installation:settingsFixture().chain.installation,runtime:null});
 const parent=parentFixture();const child=deletionFixture();
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const native=Worker.prototype.terminate;
 const terminate=vi.spyOn(Worker.prototype,'terminate').mockImplementation(function(this:Worker){return native.call(this).then(async exit=>{await gate;if(mode==='rejected')throw Error('termination uncertain');return exit;});});
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
 const runtime=startOutputDeletionRuntime({...child.options,metadata:metadata.outputDeletions,onFailure:async error=>{parent.scheduler.failedChild(error);}});parent.scheduler.own(runtime);
 try{
  await vi.advanceTimersByTimeAsync(5000);let closed=false;const closing=parent.scheduler.close().then(()=>{closed=true;});
  await vi.advanceTimersByTimeAsync(25);expect(closed).toBe(false);expect(parent.files.close).not.toHaveBeenCalled();expect(terminate).toHaveBeenCalledTimes(1);
  release();
  if(mode==='held'){await closing;expect(parent.files.close).toHaveBeenCalledTimes(1);}
  else{await expect(metadata.abort()).rejects.toThrow('termination uncertain');await vi.advanceTimersByTimeAsync(100);expect(closed).toBe(false);expect(parent.files.close).not.toHaveBeenCalled();}
 }finally{release();vi.useRealTimers();await metadata.abort().catch(()=>{});terminate.mockRestore();parent.dispose();await rm(root,{recursive:true,force:true});}
});
