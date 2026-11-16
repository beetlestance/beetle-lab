import { expect, it } from 'vitest';
import { captureTargetRuntimeReport, targetMetricNames } from '@beetle/contracts/target-runtime';
import type { TargetRuntimePhase, TargetMetricName } from '@beetle/contracts/target-runtime';
import { renderPerformanceReports } from '../../report/index.js';
import { mapK6Result } from '../../wrapper/result/index.js';
import { fixture } from '../result/fixtures.js';
const MiB=1048576;
function sample(phase:TargetRuntimePhase,index:number,readings:Partial<Record<TargetMetricName,number>>={},ready=true){
 return {observedAt:new Date(1767225600000+index*1000).toISOString(),phase,status:ready?'ready':'unavailable',reason:ready?null:'timeout',
  values:Object.fromEntries(targetMetricNames.map(name=>[name,ready?(readings[name]??null):null]))};
}
function report(samples:ReturnType<typeof sample>[]){return captureTargetRuntimeReport({format:'beetle-target-runtime',version:1,
 scope:'target-reported',limited:false,missed:samples.filter(s=>s.status==='unavailable').length,samples});}
function render(target:ReturnType<typeof report>){
 const source=fixture();const mapped=mapK6Result(source);if(!mapped.ok)throw new Error('Invalid fixture');
 return renderPerformanceReports({result:mapped.body,metrics:source.metrics,maximumBytes:262144,target});
}
const text=(bytes:Uint8Array)=>new TextDecoder().decode(bytes);
it('restores readable checkpoints, memory deltas, CPU mean and GC changes without changing mapped outcome',()=>{
 const target=report([sample('before',0,{rss:100*MiB,cpuPercent:0,'gc.count':10,'gc.totalMs':20,uptime:100}),
  sample('during',1,{rss:150*MiB,cpuPercent:75,uptime:101}),sample('during',2,{rss:130*MiB,cpuPercent:25,uptime:102}),
  sample('after',3,{rss:120*MiB,'gc.count':14,'gc.totalMs':36,uptime:103}),
  sample('after',4,{rss:105*MiB,'gc.count':15,'gc.totalMs':40,'gc.avgMs':2.66,'gc.maxMs':6,uptime:160})]);
 const output=text(render(target).text);
 expect(output).toContain('Outcome: passed');expect(output).toContain('[Target memory (MiB)]');
 expect(output).toContain('RSS: baseline=100.00; lastDuringLoad=130.00; firstPostLoad=120.00; afterCooldown=105.00; peakDuringLoad=150.00; changeAfterCooldown=5.00');
 expect(output).toContain('cpuPercent sampled during-load mean: 50.00');
 expect(output).toContain('GC count change: 4.00');expect(output).toContain('GC time change (ms): 16.00');
 expect(output).toContain('Mean pause from those counter changes (ms): 4.00');
 expect(output).toContain('cumulative average pause (ms)');expect(output).toContain('cumulative maximum pause (ms)');
 expect(output).toContain('neither establish a leak nor prove leak freedom');
});
it('keeps a missing final reading unknown instead of substituting earlier post-load data or zero',()=>{
 const target=report([sample('before',0,{rss:0}),sample('during',1,{rss:MiB}),sample('after',2,{rss:2*MiB}),sample('after',3,{},false)]);
 const output=text(render(target).text);
 expect(output).toContain('RSS: baseline=0.00; lastDuringLoad=1.00; firstPostLoad=2.00; afterCooldown=unknown; peakDuringLoad=1.00; changeAfterCooldown=unknown');
 expect(output).toContain('final post-load RSS comparison is unavailable');
});
it('suppresses growth/counter interpretation for inconsistent chronology or observed target restart',()=>{
 const reversed=report([sample('after',0,{rss:2}),sample('before',1,{rss:1})]);
 expect(text(render(reversed).text)).toContain('chronology is inconsistent');
 const restarted=report([sample('before',0,{rss:2,uptime:100,'gc.count':100,'gc.totalMs':100}),
  sample('after',1,{rss:1,uptime:2,'gc.count':5,'gc.totalMs':2})]);
 const output=text(render(restarted).text);
 expect(output).toContain('restart/reset was observed');expect(output).toContain('GC count change: unknown');
 expect(output).not.toContain('RSS is at or below baseline');
});
it('keeps derived overflowing GC ratios unknown and preserves bounded outputs',()=>{
 const target=report([sample('before',0,{'gc.count':0,'gc.totalMs':0}),
  sample('after',1,{'gc.count':Number.MIN_VALUE,'gc.totalMs':Number.MAX_VALUE})]);
 const output=render(target);expect(text(output.text)).toContain('Mean pause from those counter changes (ms): unknown');
 expect(text(output.text)).not.toContain('Infinity');expect(output.text.length).toBeLessThanOrEqual(262144);
});

it('detects visible GC counter drops even when uptime and final counter values keep increasing',()=>{
 const target=report([sample('before',0,{uptime:100,'gc.count':100,'gc.totalMs':100}),
  sample('during',1,{uptime:101,'gc.count':5,'gc.totalMs':105}),
  sample('after',2,{uptime:102,'gc.count':120,'gc.totalMs':110})]);
 const output=text(render(target).text);
 expect(output).toContain('GC count change: unknown');expect(output).toContain('GC time change (ms): 10.00');
 expect(output).toContain('Mean pause from those counter changes (ms): unknown');
 const timeReset=report([sample('before',0,{uptime:100,'gc.count':10,'gc.totalMs':100}),
  sample('during',1,{uptime:101,'gc.count':11,'gc.totalMs':2}),
  sample('after',2,{uptime:102,'gc.count':12,'gc.totalMs':120})]);
 expect(text(render(timeReset).text)).toContain('GC time change (ms): unknown');
});
