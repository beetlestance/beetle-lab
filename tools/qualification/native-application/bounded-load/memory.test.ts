import {expect,it} from 'vitest';
import {memoryFacts} from './memory.js';
import {repeatedFacts} from './public.js';
import {publicFailure} from '../conformance/failure.js';
import {publicCase} from '../conformance/outcome.js';
import {sourceCases} from '../conformance/cases.js';
import {summarizeRss} from '../rss/observe.js';
const roles=['frontend','backend','agent'];const canary='PRIVATE_CANARY';const revision='a'.repeat(40);
function trial(index:number) {
 const peers=roles.map(role=>({role,id:'',memory:role==='frontend'?67108864:268435456}));
 const rssPoints=Array.from({length:37},(_,n)=>({phase:n<2?'idle':n<4?'loaded':'post-idle',at:n*1000,
  peers:roles.map(role=>({role,processes:1,summedRssBytes:role==='frontend'?4000000:64000000-index*1024,largestProcessRssBytes:role==='frontend'?4000000:64000000-index*1024}))}));
 const artifacts=['k6-diagnostics','k6-warnings','metric-index','metric-windows','metrics-csv','native-summary','numeric-final','performance-report'].map(kind=>({kind,bytes:100,sha256:'b'.repeat(64),private:canary}));
 return {index,warmup:index===0,rssPoints,processRss:summarizeRss(rssPoints,peers),postIdleWindows:[{},{},{},{}],
  loaded:{apiP95Ms:250,endpoints:[{endpoint:'run',attempted:4,p95Ms:200},{endpoint:'live',attempted:6,p95Ms:250}],run:{state:'finished',outcome:'passed',reason:null,scope:canary},readers:[{frames:2},{frames:2},{frames:2}]},
  target:{ready:index+1,work:(index+1)*400,unexpected:0,unique:100},final:{terminalLiveUnavailable:true,artifacts},private:canary};
}
function fixture() {
 const settings={version:1,values:{pool:{outputBytes:134217728}},private:canary};
 return {unchangedInstallation:true,settingsBefore:settings,settingsAfter:structuredClone(settings),trials:[0,1,2,3].map(trial),
  retained:Array.from({length:4},()=>({executionReleased:true,originalAllocationChargedBytes:8454144,private:canary}))};
}
it('keeps fixed final-window measurements and accepts no-growth with the original latency boundary',()=>{
 const value=memoryFacts(fixture().trials);expect(value.met).toBe(true);expect(value.postIdleSeconds).toBe(32);
 expect(value.growth.every(row=>row.growthBytes===-3072)).toBe(true);expect(JSON.stringify(value)).not.toContain(canary);
});
it('retains a measured failure for positive growth or latency rather than relaxing targets',()=>{
 const growth=fixture();growth.trials[3]=trial(0);growth.trials[3]!.index=3;growth.trials[3]!.warmup=false;
 for(const point of growth.trials[3]!.rssPoints)for(const peer of point.peers){if(peer.role==='agent'){peer.summedRssBytes++;peer.largestProcessRssBytes++;}}
 growth.trials[3]!.processRss=summarizeRss(growth.trials[3]!.rssPoints,roles.map(role=>({role,id:'',memory:role==='frontend'?67108864:268435456})));
 expect(memoryFacts(growth.trials).met).toBe(false);expect(()=>repeatedFacts(growth)).toThrow();
 const latency=fixture();latency.trials[2]!.loaded.apiP95Ms=250.01;expect(memoryFacts(latency.trials).met).toBe(false);
 const masked=fixture();masked.trials[1]!.loaded.endpoints[1]!.p95Ms=251;expect(memoryFacts(masked.trials).met).toBe(false);
});
it('refuses short, sparse, malformed or inconsistent observations',()=>{
 const short=fixture();short.trials[0]!.rssPoints.splice(20);expect(()=>memoryFacts(short.trials)).toThrow();
 const windows=fixture();windows.trials[0]!.postIdleWindows.pop();expect(()=>memoryFacts(windows.trials)).toThrow();
 const summary=fixture();summary.trials[0]!.processRss[0]!.samples++;expect(()=>memoryFacts(summary.trials)).toThrow();
 const readers=fixture();readers.trials[0]!.loaded.readers[0]!.frames=1;expect(()=>memoryFacts(readers.trials)).toThrow();
 expect(()=>memoryFacts(fixture().trials.slice(1))).toThrow();
 const forged=fixture();forged.trials[0]!.loaded.endpoints[0]!.endpoint=canary;expect(()=>memoryFacts(forged.trials)).toThrow();
});
it('checks retention, unchanged settings and complete artifact sets while dropping all private fields',()=>{
 expect(JSON.stringify(repeatedFacts(fixture()))).not.toContain(canary);
 const purged=fixture();purged.retained.pop();expect(()=>repeatedFacts(purged)).toThrow();
 const settings=fixture();settings.settingsAfter.version++;expect(()=>repeatedFacts(settings)).toThrow();
 const enlarged=fixture();enlarged.settingsBefore.values.pool.outputBytes*=2;enlarged.settingsAfter=structuredClone(enlarged.settingsBefore);expect(()=>repeatedFacts(enlarged)).toThrow();
 const missing=fixture();missing.trials[1]!.final.artifacts.pop();expect(()=>repeatedFacts(missing)).toThrow();
});
it('binds successful/failed memory facts to the runtime source without a partial-pass claim',()=>{
 const input={sourceRevision:revision,architecture:'amd64',harnessNode:'v24.22.3',status:'passed',phase:'custody',cleanupVerified:true,
  imageIds:Object.fromEntries(['frontend','backend','agent','installer','engine','offline'].map(role=>[role,'sha256:'+'c'.repeat(64)])),results:fixture()};
 expect(publicCase(input,'repeated-memory',revision).status).toBe('passed');
 input.results.trials[1]!.loaded.apiP95Ms=300;input.status='failed';
 const failure=publicFailure(input,'repeated-memory',revision);expect(failure.status).toBe('failed');expect(failure.memory?.met).toBe(false);
 expect(JSON.stringify(failure)).not.toContain(canary);expect(publicFailure({...input,sourceRevision:'b'.repeat(40)},'repeated-memory',revision).memory).toBeNull();
 expect(sourceCases('repeated-memory')).toEqual([{id:'repeated-memory',script:'bounded-load/run.ts',args:[],timeoutMs:600000}]);
});

it('distinguishes the requested8MiB output from the original allocation including64KiB cleanup',()=>{
 const projected=repeatedFacts(fixture());expect(projected.retained[0]).toEqual({executionReleased:true,requestedOutputBytes:8388608,cleanupAllowanceBytes:65536,originalAllocationChargedBytes:8454144});
 for(const charged of [8388608,8454143,8454145]){const row=fixture();row.retained[0]!.originalAllocationChargedBytes=charged;expect(()=>repeatedFacts(row)).toThrow();}
});
