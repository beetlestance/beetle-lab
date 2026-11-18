import { liveMetricSubsetText } from './live-metrics.js';
import { validateApi } from './validate.js';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {captureLiveMetricHistory,encodeLiveMetricHistory,decodeLiveMetricHistory} from './live-history.js';
import type {LiveMetricHistory} from './generated/types.js';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const fixture=():LiveMetricHistory=>JSON.parse(readFileSync(new URL('../../fixtures/valid/live-metric-history.json',import.meta.url),'utf8'));
it('round-trips detached bounded history with approved-subset binding and actual source windows',()=>{
 const source=fixture();const result=decodeLiveMetricHistory(encodeLiveMetricHistory(source,hash),hash);expect(result).toEqual(source);
 source.prefix.data.bytes=9999;expect(result.prefix.data.bytes).toBe(2048);
});
it.each(['scope','subset','sampled','sequence','duration','series','last','count','getter'] as const)('rejects invalid history %s without private diagnostics',kind=>{
 const source=fixture();if(kind==='scope')source.prefix.scope.generation=2;if(kind==='subset')source.subsetDigest='f'.repeat(64);
 if(kind==='sampled')source.sampled=true;if(kind==='sequence')source.samples[0]!.sequence=2;if(kind==='duration')source.samples[0]!.endTimeMs=2000;
 if(kind==='series')source.samples[0]!.series[0]!.ordinal=1;if(kind==='last')source.prefix.endTimeMs=2000;if(kind==='count')source.samples=[];
 if(kind==='getter')Object.defineProperty(source,'samples',{get(){throw Error('PRIVATE_SENTINEL')}});
 expect(()=>captureLiveMetricHistory(source,hash)).toThrow('Live history rejected');
});
it('rejects a schema-valid history above the shared structural node bound in both directions',()=>{
 const value=fixture();const selected=Array.from({length:20},(_,ordinal)=>({...value.subset.selected[0]!,ordinal,tags:{phase:'execute' as const,request:'r'+ordinal}}));
 value.subset={selected,excludedSeries:0};value.subsetDigest=hash(liveMetricSubsetText(value.subset));value.prefix.windows=900;value.prefix.endTimeMs=900000;
 value.samples=Array.from({length:900},(_,index)=>({sequence:index+1,startTimeMs:index*1000,endTimeMs:(index+1)*1000,
 series:selected.map(row=>({...row,unit:'count' as const,total:{kind:'counter' as const,sum:7}}))}));
 expect(validateApi('LiveMetricHistory',value).ok).toBe(true);const bytes=new TextEncoder().encode(JSON.stringify(value));expect(bytes.length).toBeLessThan(16777216);
 expect(()=>decodeLiveMetricHistory(bytes,hash)).toThrow('Live history rejected');expect(()=>encodeLiveMetricHistory(value,hash)).toThrow('Live history rejected');
});
