import type {RunMetricSeries} from '@beetle/contracts/api';
export function drops(sum=3):RunMetricSeries{return {ordinal:0,metric:'dropped_iterations',kind:'counter',scope:'execute',tags:{},unit:'count',total:{kind:'counter',sum}};}
export function duration():RunMetricSeries{
 const p={source:'histogram-estimate' as const,scale:0,estimate:500,lower:400,upper:600};
 return {ordinal:1,metric:'iteration_duration',kind:'trend',scope:'execute',tags:{phase:'execute'},unit:'ms',total:{kind:'trend',count:20,sum:10000,min:400,max:600,mean:500,percentiles:{p50:p,p90:p,p95:p,p99:p}}};
}
