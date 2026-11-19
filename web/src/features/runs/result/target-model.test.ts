import { expect, it } from 'vitest';
import { captureTargetRuntimeReport, targetMetricNames } from '@beetle/contracts/target-runtime';
import type { TargetMetricName, TargetRuntimeUnits, TargetRuntimePhase } from '@beetle/contracts/target-runtime';
import { recordedTargetPlot, targetCardReading } from './target-model.js';

const origin=1700000000000;
function sample(at:number,phase:TargetRuntimePhase,values:Partial<Record<TargetMetricName,number>>={}) {
 return {observedAt:new Date(origin+at).toISOString(),phase,status:'ready',reason:null,
  values:Object.fromEntries(targetMetricNames.map(key=>[key,values[key]??null]))};
}
function report(samples:ReturnType<typeof sample>[],units?:TargetRuntimeUnits) {
 return captureTargetRuntimeReport({format:'beetle-target-runtime',version:1,scope:'target-reported',samples,limited:false,missed:0,...(units?{units}:{})});
}

it('projects all four cards with declared compatible units and native signed source time',()=>{
 const data=report([sample(-1000,'before',{rss:8000000,usedHeapSize:4,cpuPercent:0.5,systemCpuPercent:38,
  'eventLoopDelay.mean':1500000,'eventLoopDelay.p99':10000000,'eventLoopDelay.max':20000000,activeHandles:17}),sample(2000,'after',{rss:0,usedHeapSize:0})],
  {rss:'bytes',usedHeapSize:'mebibytes',cpuPercent:'ratio',systemCpuPercent:'percent','eventLoopDelay.mean':'nanoseconds','eventLoopDelay.p99':'nanoseconds','eventLoopDelay.max':'nanoseconds',activeHandles:'count'});
 const plot=recordedTargetPlot(data,origin);expect(plot.nativeTime).toBe(true);expect(plot.points.map(p=>p.t)).toEqual([-1000,2000]);
 expect(plot.cards).toHaveLength(4);expect(plot.cards[0]!.normalized).toBe(true);
 expect(plot.cards[0]!.series[0]!.values[0]).toBeCloseTo(4.194304);expect(plot.cards[0]!.series[1]!.values).toEqual([8,0]);
 expect(plot.cards[1]!.series[0]!.values).toEqual([50,null]);expect(plot.cards[2]!.series[0]!.values[0]).toBe(1.5);
 expect(targetCardReading(plot.cards[0]!,8)).toBe('8 MB');expect(targetCardReading(plot.cards[1]!,50)).toBe('50%');
 expect(plot.ticks[0]!.label).toBe('−00:01');
});

it('keeps a partially declared group entirely raw instead of mixing converted and unknown scales',()=>{
 const plot=recordedTargetPlot(report([sample(0,'before',{rss:8000000,usedHeapSize:4})],{rss:'bytes'}),null);
 expect(plot.nativeTime).toBe(false);expect(plot.cards[0]!.normalized).toBe(false);
 expect(plot.cards[0]!.series.map(s=>s.values[0])).toEqual([4,8000000]);
 expect(plot.cards[0]!.series[1]!.label).toContain('(B)');expect(plot.cards[0]!.series[0]!.label).toContain('(raw)');
 expect(plot.cards[1]!.anyReading).toBe(false);expect(plot.cards[1]!.series[0]!.values).toEqual([null]);
});

it('preserves duplicate source ordinals and clock regression without sorting or invented samples',()=>{
 const plot=recordedTargetPlot(report([sample(0,'before',{rss:1}),sample(0,'during',{rss:2}),sample(-1000,'after',{rss:3})]),null);
 expect(plot.points.map(p=>p.ordinal)).toEqual([0,1,2]);expect(plot.points.map(p=>p.gap)).toEqual([false,true,true]);
 expect(plot.cards[0]!.series[1]!.values).toEqual([1,2,3]);expect(plot.chronologySafe).toBe(false);
});

it('omits only unplottable time coordinates and keeps a visible gap and explicit omission count',()=>{
 const bad={...sample(1000,'during',{rss:2}),observedAt:'2016-12-31T23:59:60.000Z'};
 const plot=recordedTargetPlot(report([sample(0,'before',{rss:1}),bad,sample(2000,'after',{rss:3})]),null);
 expect(plot.points.map(p=>p.ordinal)).toEqual([0,2]);expect(plot.omittedTimestamps).toBe(1);expect(plot.points[1]!.gap).toBe(true);
});

it('uses scientific labels for extreme raw values and does not turn conversion overflow into zero',()=>{
 const raw=recordedTargetPlot(report([sample(0,'before',{rss:Number.MAX_VALUE})]),null).cards[0]!;
 expect(targetCardReading(raw,Number.MAX_VALUE).length).toBeLessThan(20);expect(targetCardReading(raw,Number.MIN_VALUE)).not.toBe('0');
 const cpu=recordedTargetPlot(report([sample(0,'before',{cpuPercent:Number.MAX_VALUE})],{cpuPercent:'ratio'}),origin).cards[1]!;
 expect(cpu.series[0]!.values).toEqual([null]);expect(cpu.anyReading).toBe(false);
});

it('does not replace known zero handles with another runtime activity series',()=>{
 const plot=recordedTargetPlot(report([sample(0,'before',{activeHandles:0,goroutines:9})]),null);
 expect(plot.cards[3]!.title).toBe('Active handles');expect(plot.cards[3]!.series[0]!.values).toEqual([0]);
});
