import assert from 'node:assert/strict';
import {validatePrimitive} from '@beetle/contracts';
import {record} from '../../resources/values.js';
import {bounded,count,array,images} from '../conformance/values.js';
import {comparison} from './compare.js';
import {modes} from './config.js';
import type {Point} from './observe.js';
const kinds=['metric-windows','metric-index','k6-warnings','k6-diagnostics','native-summary','numeric-final','performance-report','metrics-csv'];
function digest(value:unknown){assert(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value));return value;}
function image(value:unknown){assert(typeof value==='string'&&/^sha256:[a-f0-9]{64}$/.test(value));return value;}
function points(input:unknown):Point[]{
 assert(Array.isArray(input)&&input.length>=20&&input.length<=480);let at=-1;let cpu=-1;let index=-1;
 return input.map(value=>{
  const row=record(value);const current=count(row.index,9);assert(current>=index);index=current;assert.equal(row.mode,modes[current]);
  const time=bounded(row.at,600000);const nanos=count(row.cpuNanos,Number.MAX_SAFE_INTEGER);assert(time>at&&nanos>=cpu);at=time;cpu=nanos;
  const rss=count(row.summedRssBytes,268435456);assert(rss>0);const processes=count(row.processes,64);assert(processes>0);
  const largest=count(row.largestProcessRssBytes,rss);assert(largest>0);
  return {index:current,mode:modes[current]!,at:time,cpuNanos:nanos,memoryBytes:count(row.memoryBytes,268435456),anonymousBytes:row.anonymousBytes===null?null:count(row.anonymousBytes,268435456),
   summedRssBytes:rss,largestProcessRssBytes:largest,processes};
 });
}
function trialFacts(input:unknown,index:number){
 const row=record(input);assert.equal(row.index,index);assert.equal(row.mode,modes[index]);
 assert.deepEqual(row.budget,{cpuMillis:1000,memoryBytes:536870912,pids:128,timeoutMs:60000,outputBytes:8388608});
 const final=record(row.final);assert.deepEqual(final.assertions,{required:4,passed:4,failed:0,unknown:0});
 const numeric=record(final.numeric);assert.equal(numeric.totalsComplete,true);assert.equal(numeric.quantiles,'histogram-estimate');
 const series=count(numeric.series,64);assert(series>0);assert.equal(series,count(numeric.identities,64));
 const artifacts=array(final.artifacts,8).map(value=>{const item=record(value);assert(typeof item.kind==='string');const bytes=count(item.bytes,524288);assert(bytes>0);return {kind:item.kind,bytes,sha256:digest(item.sha256)};});
 assert.deepEqual(artifacts.map(item=>item.kind).sort(),[...kinds].sort());const bytes=artifacts.reduce((sum,item)=>sum+item.bytes,0);assert(bytes>0&&bytes<=524288);assert.equal(final.verifiedArtifactBytes,bytes);assert.equal(final.commonArtifactCeilingBytes,524288);
 const removed=record(row.removed);assert.equal(removed.containerId,row.runtimeId);assert(typeof row.runtimeId==='string'&&/^[a-f0-9]{64}$/.test(row.runtimeId));
 assert.equal(removed.fixtureCleanup,true);assert.equal(removed.storageRefund,false);assert.equal(removed.force,false);
 assert(typeof removed.liveVolume==='string'&&/^beetle-[a-f0-9]{64}-live$/.test(removed.liveVolume));
 const subscribers=array(row.subscribers,3).map(value=>{const item=record(value);const calls=count(item.calls,40);const frames=count(item.frames,calls);const unavailable=count(item.unavailable,calls);
  if(row.mode==='on')assert(frames>=2);else assert(calls===0&&frames===0&&unavailable===0);return {calls,frames,unavailable};});
 return {index,mode:modes[index]!,artifacts,subscribers,fixtureContainerRemoved:true,fixtureVolumeRemoved:true,storageRefund:false};
}
/** Closed fields only; no scope IDs, credentials, exception text, paths or copied API bodies. */
export function publicSnapshot(input:unknown,componentInput:unknown,expected:{revision:string;architecture:string;installationId:string}){
 assert(/^[a-f0-9]{40}$/.test(expected.revision));assert(['amd64','arm64'].includes(expected.architecture));assert(validatePrimitive('uuid',expected.installationId).ok);
 const row=record(input);assert(typeof row.harnessNode==='string'&&/^v24\.[0-9]+\.[0-9]+$/.test(row.harnessNode));assert.equal(row.sourceRevision,expected.revision);assert.equal(row.architecture,expected.architecture);assert.equal(row.phase,'evidence');assert.equal(row.cleanupVerified,true);
 const component=record(componentInput);assert.equal(component.installationId,expected.installationId);assert.equal(component.agentPid,1);assert.equal(component.agentUid,1000);assert.equal(component.orderlyDrained,true);
 const source=record(row.results);assert.deepEqual(source.nativeOriginals,[{status:'fulfilled'},{status:'fulfilled'}]);const measured=points(source.points);const derived=comparison(component,measured);assert.deepEqual(source.comparison,derived);
 assert.equal(row.status,derived.targetMet?'passed':'target-missed');assert.deepEqual(source.target,{ready:10,work:40000,unexpected:0});
 const baseImageIds=images(row.baseImageIds);const overlay=record(source.overlay);assert.equal(overlay.baseImageId,baseImageIds.agent);const overlayId=image(overlay.id);assert.notEqual(overlayId,baseImageIds.agent);
 const bundle=record(overlay.bundle);const bundleBytes=count(bundle.bytes,16777216);assert(bundleBytes>0);const targetSourceSha256=digest(source.targetSourceSha256);const flags=array(source.flags,2).map((value,index)=>{const item=record(value);const mode=index===0?'off':'on';assert.equal(item.mode,mode);
  assert.deepEqual(item.processOne,mode==='on'?{present:true,value:'1'}:{present:false,value:null});return {mode,processOne:mode==='on'?{present:true,value:'1'}:{present:false,value:null}};});
 const verified=array(component.results,10).map(trialFacts);
 return {harnessNode:row.harnessNode,nativeContainerOS:'linux',scope:'trusted component assembly; no installed off mode or backend HTTP overhead claim',measurementStatus:derived.targetMet?'passed':'target-missed',baseImageIds,
  actualAgentOverlay:{id:overlayId,bundleBytes,bundleSha256:digest(bundle.sha256)},flags,targetSourceSha256,comparison:derived,verified,
  target:{ready:10,work:40000,unexpected:0},agentLimits:{cpuMillis:250,memoryBytes:268435456,pids:64},
  limits:['Synthetic fixed-work fixture only; summed RSS counts shared pages more than once','Unavailable live reads are retained; no uninterrupted availability or general thermal/growth claim']};
}
