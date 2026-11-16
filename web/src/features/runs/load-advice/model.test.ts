import {expect,it} from 'vitest';
import {dropped,iterationMedian,planning} from './model.js';
import {drops,duration} from './fixtures.js';
it('distinguishes exact observed counters from absent, ambiguous and scoped signals',()=>{
 expect(dropped([drops(0)])).toBe(0);expect(dropped([drops(7)])).toBe(7);
 expect(dropped([])).toBeNull();expect(dropped([drops(),drops()])).toBeNull();
 expect(dropped([{...drops(),tags:{request:'a'}}])).toBeNull();
 expect(dropped([{...drops(),unit:'ms'}])).toBeNull();
 expect(dropped(Array.from({length:101},()=>drops()))).toBeNull();
});
it.each([-1,-0,0.5,Infinity,NaN,Number.MAX_SAFE_INTEGER+1])('rejects malformed counter %s',sum=>expect(dropped([drops(sum)])).toBeNull());
it('requires actual unambiguous iteration statistics, not HTTP latency',()=>{
 expect(iterationMedian([duration()])).toEqual({estimate:500,lower:400,upper:600,count:20});
 expect(iterationMedian([{...duration(),metric:'http_req_duration'}])).toBeNull();
 expect(iterationMedian([{...duration(),tags:{phase:'execute',request:'a'}}])).toBeNull();
 expect(iterationMedian([{...duration(),unit:'bytes'}])).toBeNull();
 expect(iterationMedian([duration(),duration()])).toBeNull();
 const row=duration();if(row.total.kind!=='trend')throw Error('fixture');
 for(const count of [0,-1,0.5,Infinity])expect(iterationMedian([{...row,total:{...row.total,count}}])).toBeNull();
 for(const p of [{estimate:0,lower:0,upper:0},{estimate:500,lower:501,upper:600},{estimate:500,lower:400,upper:499},{estimate:Infinity,lower:0,upper:Infinity}]){
  expect(iterationMedian([{...row,total:{...row.total,percentiles:{...row.total.percentiles,p50:{...row.total.percentiles.p50,...p}}}}])).toBeNull();
 }
});
it('computes a rounded explicit-input heuristic only from complete observations',()=>{
 expect(planning([duration()],'complete','10','20')).toMatchObject({status:'ready',vus:6});
 expect(planning([duration()],'complete','1','0')).toMatchObject({status:'ready',vus:1});
 for(const coverage of ['partial','unknown'] as const)expect(planning([duration()],coverage,'10','20')).toEqual({status:'coverage'});
 expect(planning([],'complete','10','20')).toEqual({status:'missing'});
});
it.each(['','0','-1','NaN','Infinity','0x10','1000001','1e999','12345678901234567'])('rejects rate input %s',rate=>expect(planning([duration()],'complete',rate,'20')).toEqual({status:'input'}));
it.each(['','-1','501','Infinity','0x10'])('rejects headroom %s',value=>expect(planning([duration()],'complete','10',value)).toEqual({status:'input'}));
it('refuses unsafe or overflowing allocations without clamping',()=>{
 const row=duration();if(row.total.kind!=='trend')throw Error('fixture');
 const huge={...row,total:{...row.total,percentiles:{...row.total.percentiles,p50:{...row.total.percentiles.p50,estimate:1e308,lower:1e307,upper:1e308}}}};
 expect(planning([huge],'complete','1000000','500')).toEqual({status:'overflow'});
});
