import type {RunMetricSeries} from '@beetle/contracts/api';
export type Coverage='complete'|'partial'|'unknown';
export interface Median {readonly estimate:number;readonly lower:number;readonly upper:number;readonly count:number}
function source(rows:readonly RunMetricSeries[],metric:string):RunMetricSeries|undefined{
 if(rows.length>100)return undefined;
 const found=rows.filter(row=>row.metric===metric&&row.scope==='execute'&&globalTags(row,metric));
 return found.length===1?found[0]:undefined;
}
function globalTags(row:RunMetricSeries,metric:string):boolean{
 const keys=Object.keys(row.tags);
 return metric==='dropped_iterations'?keys.length===0:keys.length===1&&row.tags.phase==='execute';
}
export function dropped(rows:readonly RunMetricSeries[]):number|null{
 const row=source(rows,'dropped_iterations');if(row?.kind!=='counter'||row.unit!=='count'||row.total.kind!=='counter')return null;
 const value=row.total.sum;return Number.isSafeInteger(value)&&value>=0&&!Object.is(value,-0)?value:null;
}
export function iterationMedian(rows:readonly RunMetricSeries[]):Median|null{
 const row=source(rows,'iteration_duration');if(row?.kind!=='trend'||row.unit!=='ms'||row.total.kind!=='trend')return null;
 const {count,percentiles}=row.total;const p=percentiles.p50;
 if(!Number.isSafeInteger(count)||count<1||![p.estimate,p.lower,p.upper].every(Number.isFinite))return null;
 if(!validBounds(p))return null;
 return {estimate:p.estimate,lower:p.lower,upper:p.upper,count};
}
function validBounds(p:{estimate:number;lower:number;upper:number}):boolean{
 return p.estimate>0&&p.lower>=0&&p.lower<=p.estimate&&p.upper>=p.estimate;
}
export type Plan={status:'ready';vus:number;median:Median}|{status:'coverage'|'missing'|'input'|'overflow'};
function decimal(value:string):number|null{
 if(value.length>16||!/^\d*\.?\d+(?:e[+-]?\d{1,3})?$/i.test(value))return null;
 const number=Number(value);return Number.isFinite(number)?number:null;
}
function boundedDecimal(value:string,max:number):number|null{
 const parsed=decimal(value);return parsed!==null&&parsed>=0&&parsed<=max?parsed:null;
}
export function planning(rows:readonly RunMetricSeries[],coverage:Coverage,rateText:string,headroomText:string):Plan{
 if(coverage!=='complete')return {status:'coverage'};
 const median=iterationMedian(rows);if(!median)return {status:'missing'};
 const rate=boundedDecimal(rateText,1000000);const headroom=boundedDecimal(headroomText,500);
 if(rate===null||rate===0||headroom===null)return {status:'input'};
 return planningWithMedian(median,rate,headroom);
}
export function planningWithMedian(median:Median,rate:number,headroom:number):Plan{
 if(!validBounds(median)||!Number.isFinite(rate)||rate<=0||rate>1e9||!Number.isFinite(headroom)||headroom<0||headroom>500)return {status:"input"};
 const raw=median.estimate/1000*rate*(1+headroom/100);const vus=Math.ceil(raw);
 if(!Number.isSafeInteger(vus)||vus<1)return {status:'overflow'};
 return {status:'ready',vus,median};
}
