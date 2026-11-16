import assert from 'node:assert/strict';
import {record,counter} from '../../resources/values.js';
import {modes} from './config.js';
import type {Point} from './observe.js';
export function comparison(input:unknown,points:readonly Point[]){
 const report=record(input);assert.equal(report.status,'passed');assert.equal(report.orderlyDrained,true);assert(Array.isArray(report.results)&&report.results.length===modes.length);
 const trials=report.results.map((value,index)=>{
  const trial=record(value);assert.equal(trial.index,index);assert.equal(trial.mode,modes[index]);assert.equal(trial.warmup,index<2);
  const wallMs=counter(trial.wallMs);assert(wallMs>=1000&&wallMs<60000);const final=record(trial.final);const numeric=record(final.numeric);
  assert.equal(numeric.requestCount,4000);assert.equal(numeric.durationCount,4000);assert.equal(final.completeness,'complete');assert.equal(final.outcome,'passed');
  const samples=points.filter(point=>point.index===index);assert(samples.length>=2);
  const first=samples[0]!;const last=samples.at(-1)!;assert(last.at>first.at&&last.cpuNanos>=first.cpuNanos);
  assert(samples.every(point=>point.mode===modes[index]&&point.memoryBytes<=268435456&&point.summedRssBytes<=268435456));
  return {index,mode:modes[index],warmup:index<2,wallMs,agent:{samples:samples.length,
   cpuOneCorePercent:(last.cpuNanos-first.cpuNanos)/((last.at-first.at)*10000),peakSummedRssBytes:Math.max(...samples.map(point=>point.summedRssBytes)),
   peakCgroupBytes:Math.max(...samples.map(point=>point.memoryBytes))}};
 });
 const pairs=[];for(let index=2;index<10;index+=2){
  const pair=trials.slice(index,index+2);const off=pair.find(trial=>trial.mode==='off')!;const on=pair.find(trial=>trial.mode==='on')!;assert(off&&on);
  pairs.push({indices:pair.map(trial=>trial.index),offMs:off.wallMs,onMs:on.wallMs,additionalWallPercent:(on.wallMs/off.wallMs-1)*100});
 }
 const offMs=pairs.reduce((sum,pair)=>sum+pair.offMs,0);const onMs=pairs.reduce((sum,pair)=>sum+pair.onMs,0);
 const additionalWallPercent=(onMs/offMs-1)*100;
 return {trials,pairs,offMs,onMs,additionalWallPercent,targetPercent:5,targetMet:additionalWallPercent<=5,
  aggregation:'sum of four paired on times divided by sum of paired off times; first two trials excluded as warm-up'};
}
