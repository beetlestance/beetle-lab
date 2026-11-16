import {expect,it} from 'vitest';
import {comparison} from './compare.js';
import {modes} from './config.js';
import type {Point} from './observe.js';
function fixture(onMs=10400){
 const results=modes.map((mode,index)=>({index,mode,warmup:index<2,wallMs:index<2?40000:mode==='on'?onMs:10000,
  final:{numeric:{requestCount:4000,durationCount:4000},completeness:'complete',outcome:'passed'}}));
 const points:Point[]=modes.flatMap((mode,index)=>[0,1].map(n=>({index,mode,at:index*2000+n*1000,cpuNanos:index*10000000+n*1000000,
  memoryBytes:100000000,anonymousBytes:90000000,processes:1,summedRssBytes:110000000,largestProcessRssBytes:110000000})));
 return {report:{status:'passed',orderlyDrained:true,results},points};
}
it('uses all four balanced pairs and excludes both warm-up times',()=>{
 const f=fixture();const result=comparison(f.report,f.points);expect(result.pairs).toHaveLength(4);
 expect(result.offMs).toBe(40000);expect(result.onMs).toBe(41600);expect(result.additionalWallPercent).toBeCloseTo(4);expect(result.targetMet).toBe(true);
});
it('retains a measured target miss instead of weakening the five-percent target',()=>{
 const f=fixture(10600);expect(comparison(f.report,f.points)).toMatchObject({targetPercent:5,targetMet:false});
});
it('refuses incomplete work, changed mode ordering and missing resource observations',()=>{
 const f=fixture();f.report.results[3]!.final.numeric.requestCount=3999;expect(()=>comparison(f.report,f.points)).toThrow();
 const g=fixture();g.report.results[2]!.mode='on';expect(()=>comparison(g.report,g.points)).toThrow();
 const h=fixture();expect(()=>comparison(h.report,h.points.filter(point=>point.index!==4))).toThrow();
});
