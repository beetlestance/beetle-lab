import { performance } from 'node:perf_hooks';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import * as builder from '../../build/index.js';
import { startStandaloneBuild } from '../../export/index.js';
import { suite, directories } from '../export/fixtures.js';
import { sealExportScript } from '../../wrapper/artifact-custody/index.js';
import { AttemptFence } from '../../wrapper/attempt/fence.js';
const directory=directories(); afterEach(() => {vi.restoreAllMocks(); vi.useRealTimers();});
function deferred<T>() {let resolve!: (value:T)=>void; let reject!: (error:unknown)=>void; const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;}); return {promise,resolve,reject};}
async function pending(value:Promise<unknown>) {let done=false; void value.then(()=>{done=true;},()=>{done=true;}); await Promise.resolve(); await Promise.resolve(); return !done;}
function metadata(root:string) {return {scriptPath:join(root,'suite.js'),bytes:64,peakBytes:256};}
it('uses the actual shared compiler/builder then native custody without a load process',async () => {
  const root=await directory(); const maximumBuildBytes=2 * 1048576; const parent=new AbortController();
  const fence=new AttemptFence({wall:Date.now,monotonic:()=>performance.now()},parent.signal,5000);
  try {
    const work=startStandaloneBuild({suite:suite({embedded:true}),outputDirectory:join(root,'standalone'),timeoutMs:60000,maximumBuildBytes,signal:parent.signal,deadline:performance.now()+5000});
    const built=await work.result; await work.settled;
    const custody=sealExportScript({outputRoot:root,uid:process.getuid!(),built,maximumBuildBytes,fence});
    expect(await custody.result).toMatchObject({kind:'standalone-k6-script',bytes:built.bytes}); await custody.settled;
  } finally {fence.dispose();}
});
it('captures scalars before async work, preserving the downloaded timeout independently of the build deadline',async () => {
  const root=await directory(); const held=deferred<ReturnType<typeof metadata>>(); const entered=deferred<void>();
  const spy=vi.spyOn(builder,'buildRuntimeScript').mockImplementation(async () => {entered.resolve(); return held.promise;});
  const input={suite:suite(),outputDirectory:root,timeoutMs:180000,maximumBuildBytes:1048576,signal:new AbortController().signal,deadline:performance.now()+5000};
  const work=startStandaloneBuild(input); input.outputDirectory='changed'; input.timeoutMs=1; input.maximumBuildBytes=1; input.deadline=0;
  await entered.promise; expect(spy.mock.calls[0]![0]).toMatchObject({outputDirectory:root,attempt:{mode:'standalone',timeoutMs:180000},maximumBuildBytes:1048576});
  held.resolve(metadata(root)); expect(await work.result).toEqual(metadata(root)); await work.settled;
});
it.each(['cancel','close'] as const)('retains an issued original after %s and refuses a later successful reply',async stop => {
  const root=await directory(); const held=deferred<ReturnType<typeof metadata>>(); const entered=deferred<void>(); const parent=new AbortController();
  vi.spyOn(builder,'buildRuntimeScript').mockImplementation(async () => {entered.resolve(); return held.promise;});
  const work=startStandaloneBuild({suite:suite(),outputDirectory:root,timeoutMs:60000,maximumBuildBytes:1048576,signal:parent.signal,deadline:performance.now()+5000});
  await entered.promise; const closing=stop==='close' ? work.close() : undefined; if (stop==='cancel') parent.abort();
  await expect(work.result).rejects.toMatchObject({code:stop==='close'?'closed':'cancelled'}); expect(await pending(work.settled)).toBe(true);
  if (closing) expect(await pending(closing)).toBe(true); held.resolve(metadata(root)); await work.settled; await closing;
});
it('retains original late build failure after logical cancellation instead of declaring native cleanup proved',async () => {
  const root=await directory(); const held=deferred<ReturnType<typeof metadata>>(); const entered=deferred<void>(); const parent=new AbortController();
  vi.spyOn(builder,'buildRuntimeScript').mockImplementation(async () => {entered.resolve(); return held.promise;});
  const work=startStandaloneBuild({suite:suite(),outputDirectory:root,timeoutMs:60000,maximumBuildBytes:1048576,signal:parent.signal,deadline:performance.now()+5000});
  await entered.promise; parent.abort(); await expect(work.result).rejects.toMatchObject({code:'cancelled'});
  held.reject(new Error('private source canary')); await expect(work.settled).rejects.toMatchObject({code:'build_failed',message:'Standalone build rejected'});
});
it.each(['closed','aborted','expired'] as const)('starts no builder work for an already %s original',async state => {
  const root=await directory(); const spy=vi.spyOn(builder,'buildRuntimeScript'); const parent=new AbortController(); if (state==='aborted') parent.abort();
  const work=startStandaloneBuild({suite:suite(),outputDirectory:root,timeoutMs:60000,maximumBuildBytes:1048576,signal:parent.signal,deadline:state==='expired'?0:performance.now()+5000});
  const closing=state==='closed'?work.close():undefined;
  await expect(work.result).rejects.toMatchObject({code:state==='aborted'?'cancelled':state==='expired'?'deadline':'closed'});
  await work.settled; await closing; expect(spy).not.toHaveBeenCalled();
});
it('rejects a late original before a timeout callback runs and rejects monotonic rollback',async () => {
  const root=await directory(); let now=1000; vi.spyOn(performance,'now').mockImplementation(()=>now);
  const spy=vi.spyOn(builder,'buildRuntimeScript').mockImplementation(async () => {now=1100; return metadata(root);});
  const late=startStandaloneBuild({suite:suite(),outputDirectory:root,timeoutMs:60000,maximumBuildBytes:1048576,signal:new AbortController().signal,deadline:1050});
  await expect(late.result).rejects.toMatchObject({code:'deadline'}); await late.settled; expect(spy).toHaveBeenCalledTimes(1);
  now=1000; spy.mockImplementationOnce(async () => {now=999; return metadata(root);});
  const rolled=startStandaloneBuild({suite:suite(),outputDirectory:root,timeoutMs:60000,maximumBuildBytes:1048576,signal:new AbortController().signal,deadline:1500});
  await expect(rolled.result).rejects.toMatchObject({code:'clock_fenced'}); await rolled.settled;
});
it('expires a held original on its one timer while still retaining the call',async () => {
  const root=await directory(); vi.useFakeTimers(); let now=1000; vi.spyOn(performance,'now').mockImplementation(()=>now);
  const held=deferred<ReturnType<typeof metadata>>(); const entered=deferred<void>();
  vi.spyOn(builder,'buildRuntimeScript').mockImplementation(async () => {entered.resolve(); return held.promise;});
  const work=startStandaloneBuild({suite:suite(),outputDirectory:root,timeoutMs:60000,maximumBuildBytes:1048576,signal:new AbortController().signal,deadline:1050});
  await entered.promise; now=1050; await vi.advanceTimersByTimeAsync(50); await expect(work.result).rejects.toMatchObject({code:'deadline'});
  expect(await pending(work.settled)).toBe(true); held.resolve(metadata(root)); await work.settled; expect(vi.getTimerCount()).toBe(0);
});

it.each(['clock','timer'] as const)('fences an unexpected %s failure before issuing the original',async source => {
  const root=await directory(); const spy=vi.spyOn(builder,'buildRuntimeScript');
  const deadline=performance.now()+5000;
  if (source==='clock') vi.spyOn(performance,'now').mockImplementation(()=>{throw new Error('private canary');});
  else vi.spyOn(globalThis,'setTimeout').mockImplementation(()=>{throw new Error('private canary');});
  const work=startStandaloneBuild({suite:suite(),outputDirectory:root,timeoutMs:60000,maximumBuildBytes:1048576,signal:new AbortController().signal,deadline});
  await expect(work.result).rejects.toMatchObject({code:'clock_fenced',message:'Standalone build rejected'});
  await work.settled; expect(spy).not.toHaveBeenCalled();
});
