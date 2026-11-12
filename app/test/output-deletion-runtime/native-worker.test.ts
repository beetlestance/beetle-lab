import {expect,it} from 'vitest';
import {stat,mkdtemp,realpath,chmod,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {nativeFixture} from '../run-metrics/native-fixture.js';
import {storageFixture,scope} from '../storage/fixture.js';
import {retained} from '../output-deletion/retained.js';
import {command} from '../output-deletion/fixture.js';
import {deferred,fixture as filesFixture} from '../files/output-bytes/fixture.js';
import {fixture as runtimeFixture} from '../output-runtime/fixture.js';
import {openOutputRuntime} from '../../src/bootstrap/output-runtime/index.js';
import {startOutputDeletionRuntime} from '../../src/application/output-deletion-runtime/index.js';
import type {OutputDeletionRuntimeOptions} from '../../src/application/output-deletion-runtime/index.js';
const storage=storageFixture();
it('automatically deletes committed native files across lost plan and absence replies while preserving every producer charge/fact',async()=>{
 const dataRoot=await realpath(await mkdtemp(join(tmpdir(),'beetle-deletion-installed-')));await chmod(dataRoot,0o700);
 const f=await nativeFixture(()=>filesFixture(undefined,undefined,join(dataRoot,'outputs')));let current:ReturnType<typeof startOutputDeletionRuntime>|undefined;
 const parent=runtimeFixture();
 try{
  const path=storage.path();f.db.prepare('VACUUM INTO ?').run(path);const before=retained(path);
  let metadata=await storage.open(path,{runtime:null,runs:f.config});const summary=await metadata.outputDeletions.begin(command(f));
  const key={scope,id:summary.id,runId:summary.runId};const initial=await metadata.inputs.storage();
  const firstFile=await metadata.outputDeletions.getFile({...key,ordinal:0});
  const failedPlan=deferred<unknown>();let losePlan=true;
  const first:OutputDeletionRuntimeOptions={metadata:{...metadata.outputDeletions,recordPlan:async request=>{
   const result=await metadata.outputDeletions.recordPlan(request);if(losePlan){losePlan=false;throw Error('Lost committed plan reply');}return result;
  }},files:f.files.store,freeSpaceReserveBytes:0,intervalMs:25,onFailure:async error=>{failedPlan.resolve(error);}};
  current=startOutputDeletionRuntime(first);await failedPlan.promise;await expect(current.close()).rejects.toThrow('Lost committed plan reply');current=undefined;
  const prepared=await metadata.outputDeletions.getFile({...key,ordinal:0});expect(prepared.phase).toBe('prepared');
  expect((await stat(f.files.path(firstFile.record,true))).isFile()).toBe(true);
  await storage.close(metadata);await f.files.reopen();metadata=await storage.open(path,{runtime:null,runs:f.config});
  const failedAbsence=deferred<unknown>();let loseAbsence=true;
  current=startOutputDeletionRuntime({...first,files:f.files.store,metadata:{...metadata.outputDeletions,recordAbsence:async request=>{
   const result=await metadata.outputDeletions.recordAbsence(request);if(loseAbsence){loseAbsence=false;throw Error('Lost committed absence reply');}return result;
  }},onFailure:async error=>{failedAbsence.resolve(error);}});
  await failedAbsence.promise;await expect(current.close()).rejects.toThrow('Lost committed absence reply');current=undefined;
  await expect(stat(f.files.path(firstFile.record,true))).rejects.toMatchObject({code:'ENOENT'});
  await storage.close(metadata);await f.files.reopen();metadata=await storage.open(path,{runtime:null,runs:f.config});
  await f.files.store.close();parent.outputs.scan.mockResolvedValue({items:[],nextCursor:null});
  current=await openOutputRuntime({...parent.options,dataRoot,deletions:metadata.outputDeletions});
  let done=false;const deadline=performance.now()+10000;
  for(let calls=0;calls<200&&performance.now()<deadline;calls++){
   if((await metadata.outputDeletions.get(key)).stage==='files_absent'){done=true;break;}
   await new Promise(resolve=>setTimeout(resolve,25));
  }
  expect(done).toBe(true);await current.close();current=undefined;
  expect(await metadata.outputDeletions.scan({limit:32})).toEqual({items:[],nextCursor:null});
  expect(await metadata.inputs.storage()).toEqual(initial);
  expect((await metadata.results.getRunResult({scope,id:key.runId})).result).toEqual(f.envelope.manifest.result);
  await storage.close(metadata);expect(retained(path)).toBe(before);
 }finally{await current?.close();await f.files.dispose();parent.dispose();await rm(dataRoot,{recursive:true,force:true});}
},20000);
