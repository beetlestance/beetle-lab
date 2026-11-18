import {expect,it} from 'vitest';
import type {RunChartHistory,RunMetricOverview} from '@beetle/contracts/api';
import source from '../../../../../contracts/fixtures/api/valid/run-chart-history.json' with {type:'json'};
import overview from '../../../../../contracts/fixtures/api/valid/run-metric-overview.json' with {type:'json'};
import {recordedPlot,sameChartSource} from './chart-model.js';
const value=()=>structuredClone(source) as RunChartHistory;
it('projects actual counts, percentile estimates and zero gauges on native source time',()=>{
 const data=value();const plot=recordedPlot(data)!;
 expect(plot.points).toHaveLength(3);expect(plot.points[0]).toMatchObject({t:1000,rps:9,failedPerSecond:1,vus:0,vusMax:null});
 expect(plot.points[0]?.p95).toBe(data.points[0]?.httpP95?.estimate);expect(plot.domain).toEqual([0,3000]);
});
it('preserves missing values and source gaps without adding zero windows',()=>{
 const data=value();data.points[1]!.gapBefore=true;data.points[1]!.requestCount=null;data.points[1]!.httpFailures=null;
 const plot=recordedPlot(data)!;expect(plot.points).toHaveLength(data.points.length);expect(plot.points[1]).toMatchObject({rps:null,failedPerSecond:null,gapBefore:true});
 data.reason='too_large';expect(recordedPlot(data)).toBeNull();
});
it('requires the same numeric original and marker before combining a peak with summary tiles',()=>{
 const summary={...overview,source:structuredClone(source.source)} as RunMetricOverview;
 const history=value();expect(sameChartSource(summary,history)).toBe(true);
 history.source!.numericSha256='f'.repeat(64);expect(sameChartSource(summary,history)).toBe(false);
});
it('keeps signed source time explicit when the recorded marker follows an earlier window',()=>{
 const data=value();data.source!.measurementSourceTimeMs+=4000;
 const plot=recordedPlot(data)!;expect(plot.points[0]?.t).toBe(-3000);expect(plot.ticks[0]?.label).toBe('−00:04');
 expect(plot.domain.every(Number.isFinite)).toBe(true);
});
