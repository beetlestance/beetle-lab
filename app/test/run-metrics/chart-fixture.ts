import { DurationHistogram } from '@beetle/contracts/metrics';
import type { SeriesTotal } from '@beetle/contracts/metrics';
import { fixture, rebindPair, rewrite } from './fixture.js';
const T0=1800000000000;
function traffic(count: number, failures: number): SeriesTotal[] {
  const tags={phase:'execute' as const,request:'r0'};
  const rows:SeriesTotal[]=[
    {metric:'http_reqs',kind:'counter',scope:'execute',tags,total:{kind:'counter',sum:count}},
    {metric:'http_req_failed',kind:'rate',scope:'execute',tags,total:{kind:'rate',numerator:failures,sampleCount:count}},
  ];
  if(count){const h=new DurationHistogram();for(let i=0;i<count;i++)h.record(1);
    rows.push({metric:'http_req_duration',kind:'trend',scope:'execute',tags,total:{kind:'trend',count,sum:count,min:1,max:1,mean:1,distribution:h.snapshot()}});}
  return rows;
}
export async function chartFixture(n=3, counts:(i:number)=>number=()=>9, gapAfter=-1, vus:(i:number)=>number|null=i=>i) {
  const f=await fixture();f.chunkSize.bytes=65536;
  const data=f.descriptors.find(a=>a.kind==='metric-windows')!;
  const header=f.contents.get(data.artifactId)!.toString('utf8').split('\n')[0]!;
  const values=Array.from({length:n},(_,i)=>counts(i));const gauges=Array.from({length:n},(_,i)=>vus(i));const failures=values.map(count=>count?1:0);
  const lines=values.map((count,i)=>{
    const time=T0+(i+Number(gapAfter>=0 && i>gapAfter))*1000;
    const series=traffic(count,failures[i]!);
    const gauge=gauges[i];if(gauge!==null)series.push({metric:'vus',kind:'gauge',scope:'engine',tags:{},total:{kind:'gauge',latest:gauge!,sourceTimeMs:time,min:gauge!,max:gauge!}});
    return JSON.stringify({kind:'window',sequence:i+1,window:{startTimeMs:time,endTimeMs:time+1000,series}});
  });
  rewrite(f,'metric-windows',()=>[header,...lines,JSON.stringify({kind:'end',windows:n}),''].join('\n'));
  let offset=Buffer.byteLength(header)+1;
  rewrite(f,'metric-index',text=>[text.split('\n')[0],...lines.map((line,i)=>{
    const window=JSON.parse(line).window;const row={sequence:i+1,startTimeMs:window.startTimeMs,endTimeMs:window.endTimeMs,offset,length:Buffer.byteLength(line)+1};offset+=row.length;return JSON.stringify(row);
  }),JSON.stringify({kind:'end',windows:n,dataBytes:0,dataSha256:'0'.repeat(64)}),''].join('\n'));
  rewrite(f,'numeric-final',text=>{
    const value=JSON.parse(text);value.history.windows=n;
    const total=values.reduce((a,b)=>a+b,0),failed=failures.reduce<number>((a,b)=>a+b,0);
    value.metrics.totals=traffic(total,failed);
    const known=gauges.flatMap((gauge,index)=>gauge===null?[]:[{gauge,index}]);const last=known.at(-1);
    if(last)value.metrics.totals.push({metric:'vus',kind:'gauge',scope:'engine',tags:{},total:{kind:'gauge',latest:last.gauge,sourceTimeMs:T0+(last.index+Number(gapAfter>=0 && last.index>gapAfter))*1000,min:Math.min(...known.map(g=>g.gauge)),max:Math.max(...known.map(g=>g.gauge))}});
    return JSON.stringify(value);
  });rebindPair(f);return f;
}
