import {afterEach,expect,it} from 'vitest';
import {chartSampleOrdinals,runChartHistoryMatches,validateApi} from '@beetle/contracts/api';
import type {RunMetricsService} from '../../src/ports/run-metrics.js';
import {chartFixture} from './chart-fixture.js';
import {context,rewrite,rebindPair} from './fixture.js';
const services:RunMetricsService[]=[];
afterEach(async()=>{await Promise.all(services.splice(0).map(s=>s.close()));});
function reader(f:Awaited<ReturnType<typeof chartFixture>>){const service=f.service();services.push(service);const key={id:f.query.id,scope:f.query.scope,attemptId:f.query.attemptId};return {service,key,read:()=>service.reader.getRunChartHistory(key,context())};}
it('returns real source windows, pooled percentiles and actual zero gauges',async()=>{
 const f=await chartFixture();const {read,key}=reader(f);const value=await read();
 expect(validateApi('RunChartHistory',value).ok).toBe(true);expect(runChartHistoryMatches(value,key)).toBe(true);
 expect(value).toMatchObject({reason:null,windows:3,sampled:false,observedPeakRequestsPerSecond:9,knownRequestWindows:3});
 expect(value.points.map(p=>p.sequence)).toEqual([1,2,3]);expect(value.points[0]).toMatchObject({requestCount:9,httpFailures:1,httpSamples:9,vus:0,vusMax:null,gapBefore:false});
 expect(value.points[0]?.httpP95?.source).toBe('histogram-estimate');
 const data=f.descriptors.find(a=>a.kind==='metric-windows')!;
 expect(f.reads.filter(r=>r.id===data.artifactId&&r.start===0&&r.end===data.bytes)).toHaveLength(1);
});
it('samples at most900 actual ordinals, preserves endpoints and finds peak in a window not selected',async()=>{
 const chosen=new Set(chartSampleOrdinals(901));const skipped=Array.from({length:901},(_,i)=>i+1).find(i=>!chosen.has(i))!;
 const f=await chartFixture(901,i=>i+1===skipped?1000:9);const {read,key}=reader(f);const value=await read();
 expect(value.points).toHaveLength(900);expect(value.points[0]?.sequence).toBe(1);expect(value.points.at(-1)?.sequence).toBe(901);
 expect(value.points.some(p=>p.sequence===skipped)).toBe(false);expect(value.observedPeakRequestsPerSecond).toBe(1000);expect(value.knownRequestWindows).toBe(901);
 expect(value.sampled).toBe(true);expect(runChartHistoryMatches(value,key)).toBe(true);
});
it('preserves gaps and genuine zero counts without filling missing source time',async()=>{
 const f=await chartFixture(3,()=>0,0);const {read,key}=reader(f);const value=await read();
 expect(value.points.map(p=>p.gapBefore)).toEqual([false,true,false]);
 expect(value.points[0]).toMatchObject({requestCount:0,httpSamples:0,httpP95:null});
 expect(value.observedPeakRequestsPerSecond).toBe(0);expect(runChartHistoryMatches(value,key)).toBe(true);
});
it('rejects rehashed malformed sequences and changed bytes rather than returning a shortened history',async()=>{
 const malformed=await chartFixture();rewrite(malformed,'metric-windows',text=>text.replace('"sequence":2','"sequence":3'));rebindPair(malformed);
 await expect(reader(malformed).read()).rejects.toMatchObject({code:'unavailable'});
 const tampered=await chartFixture();rewrite(tampered,'metric-windows',text=>text.replace('"sequence":2','"sequence":3'),false);
 await expect(reader(tampered).read()).rejects.toMatchObject({code:'unavailable'});
});
it('refuses oversized histories before a full data scan and keeps unavailable history explicit',async()=>{
 const large=await chartFixture(3601);const first=reader(large);const value=await first.read();
 expect(value).toMatchObject({reason:'too_large',points:[],sampled:false,knownRequestWindows:0,observedPeakRequestsPerSecond:null});
 expect(runChartHistoryMatches(value,first.key)).toBe(true);
 const data=large.descriptors.find(a=>a.kind==='metric-windows')!;
 expect(large.reads.some(r=>r.id===data.artifactId&&r.start===0&&r.end===data.bytes)).toBe(false);
 const absent=await chartFixture();absent.descriptors.splice(0,absent.descriptors.length,...absent.descriptors.filter(a=>a.kind==='numeric-final'));
 expect(await reader(absent).read()).toMatchObject({reason:'not_recorded',source:null,windows:0,points:[]});
});
