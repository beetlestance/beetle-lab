import { createHash } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createStandaloneExportAssignment } from '@beetle/contracts';
import { fixture, opened, now, uuid, syntheticInstalledIdentity } from '../staged-input/fixtures.js';
import type { Fixture } from '../staged-input/fixtures.js';
import type { SuiteConfig } from '../../compiler/suite/index.js';
import { AttemptFence } from '../../wrapper/lifecycle/index.js';
import { startExportOperation } from '../../export/index.js';
import * as builder from '../../build/index.js';
const fixtures:Fixture[]=[];const fences:AttemptFence[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const f of fences.splice(0))f.dispose();for(const f of fixtures.splice(0)){f.controller.abort();await f.cleanup();}});
async function setup(){
  const f=await fixture();fixtures.push(f);
  const config=f.offer.config as unknown as SuiteConfig;config.secrets=[];config.requests[0]!.headers={};
  f.offer.secretReferences=[];f.staging.secretNames=[];await rm(join(f.options.secretRoot,'_TOKEN'));
  f.manifest.capabilities.push('standalone-export-v1');f.offer.requiredCapabilities=['standalone-export-v1'];
  f.offer.installedIdentity=syntheticInstalledIdentity(f.manifest);f.staging.generation=1;await f.save();
  const assignment=createStandaloneExportAssignment({version:1,purpose:'standalone_export',exportId:uuid(20),requestId:uuid(21),
    source:{revisionId:uuid(22),revisionDigest:'b'.repeat(64)},offer:f.offer,
    options:{scriptTimeoutMs:180000,maximumBuildBytes:900000}},s=>createHash('sha256').update(s).digest('hex'));
  f.manifest.schemas.result='https://beetle-lab.dev/contracts/runner/v1/export-result';
  f.offer.installedIdentity=syntheticInstalledIdentity(f.manifest);
  const body={...assignment,offer:f.offer};Reflect.deleteProperty(body,'assignmentDigest');
  const finalAssignment=createStandaloneExportAssignment(body,s=>createHash('sha256').update(s).digest('hex'));
  f.staging.assignment={purpose:'standalone_export',assignmentDigest:finalAssignment.assignmentDigest,fileName:'assignment.json'};
  f.options={...f.options,exportAssignment:{purpose:'standalone_export',assignmentDigest:finalAssignment.assignmentDigest},installed:{...f.options.installed,resultSchema:f.manifest.schemas.result}};
  await f.save();await writeFile(join(f.options.inputRoot,'assignment.json'),JSON.stringify(finalAssignment),{mode:0o600});
  const staged=await opened(f.options);
  const fence=new AttemptFence({wall:()=>now,monotonic:()=>performance.now()},f.controller.signal,5000);fence.bind(staged);fences.push(fence);
  return {f,staged,assignment:finalAssignment,fence,outputRoot:f.root,uid:process.getuid!()};
}
it('composes exact staged inputs through actual compiler/build/native custody without target execution',async()=>{
  const value=await setup();const work=startExportOperation(value);const result=await work.result;await work.settled;
  expect(result.artifact).toMatchObject({kind:'standalone-k6-script',relativePath:'standalone/suite.js',bytes:result.buildUsage.bytes});
  expect(result.buildUsage.peakBytes).toBeLessThanOrEqual(value.assignment.options.maximumBuildBytes);
  expect(await value.staged.compile().result).toMatchObject({ok:false,code:'closed'});
});
it('refuses changed assignment before staged compilation and leaves ownership with caller',async()=>{
  const value=await setup();const compile=vi.fn(()=>value.staged.compile());const staged={...value.staged,compile};
  expect(()=>startExportOperation({...value,staged,assignment:{...value.assignment,assignmentDigest:'a'.repeat(64)}})).toThrow('Standalone export operation rejected');
  expect(compile).not.toHaveBeenCalled();await value.staged.close();
});
it('refuses a correctly hashed different Offer before compilation',async()=>{
  const value=await setup();const body={...value.assignment};Reflect.deleteProperty(body,'assignmentDigest');
  const assignment=createStandaloneExportAssignment({...body,offer:{...body.offer,config:{...(body.offer.config as object),target:'https://other.invalid'}}},s=>createHash('sha256').update(s).digest('hex'));
  expect(()=>startExportOperation({...value,assignment})).toThrow('Standalone export operation rejected');await value.staged.close();
});
it('retains stage close failure on original settlement with fixed diagnostics',async()=>{
  const value=await setup();const actual=value.staged.close.bind(value.staged);
  const staged={...value.staged,async close(){await actual();throw new Error('private canary');}};
  const work=startExportOperation({...value,staged});await expect(work.result).rejects.toMatchObject({code:'cleanup',message:'Standalone export operation rejected'});
  await expect(work.settled).rejects.toMatchObject({code:'cleanup'});
});
it('close before start issues no compile and retains staged close',async()=>{
  const value=await setup();let calls=0;const staged={...value.staged,compile(){calls++;return value.staged.compile();}};
  const work=startExportOperation({...value,staged});const close=work.close();await expect(work.result).rejects.toMatchObject({code:'closed'});
  await expect(close).rejects.toMatchObject({code:'generation_failed'});expect(calls).toBe(0);
});
it('cancel rejects promptly while retaining the held builder original',async()=>{
  const value=await setup();let release!:()=>void;let entered!:()=>void;
  const ready=new Promise<void>(r=>{entered=r;});const hold=new Promise<void>(r=>{release=r;});
  vi.spyOn(builder,'buildRuntimeScript').mockImplementation(async()=>{entered();await hold;throw new Error('private build canary');});
  const work=startExportOperation(value);await ready;value.f.controller.abort();await expect(work.result).rejects.toMatchObject({code:'cancelled'});
  let done=false;void work.settled.then(()=>{done=true;},()=>{done=true;});await Promise.resolve();expect(done).toBe(false);
  release();await expect(work.settled).rejects.toMatchObject({code:'generation_failed'});
});

it.each(['deadline','clock','cancelled'] as const)('preserves the actual %s fence reason',async cause=>{
  const value=await setup();const work=startExportOperation(value);value.fence.stop(cause);
  await expect(work.result).rejects.toMatchObject({code:cause==='clock'?'clock_fenced':cause});
  await expect(work.settled).rejects.toMatchObject({code:'generation_failed'});
});
it('narrows an unbound fence to staged authority without extending a stricter parent ceiling',async()=>{
  const value=await setup();let wall=now;let mono=1000;
  const fence=new AttemptFence({wall:()=>wall,monotonic:()=>mono},value.f.controller.signal,120000);fences.push(fence);
  fence.narrow(value.staged);expect(fence.lifetimeRemaining()).toBe(60000);
  wall+=60000;mono+=60000;expect(()=>fence.check()).toThrow();expect(fence.reason).toBe('deadline');
  const tighter=new AttemptFence({wall:()=>now,monotonic:()=>1000},value.f.controller.signal,25);fences.push(tighter);
  tighter.narrow(value.staged);expect(tighter.lifetimeRemaining()).toBe(25);await value.staged.close();
});
