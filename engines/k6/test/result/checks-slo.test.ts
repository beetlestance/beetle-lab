import { expect, it } from 'vitest';
import { mapK6Result } from '../../wrapper/result/index.js';
import { configFor } from '../runtime/fixtures.js';
import { fixture, threshold, count } from './fixtures.js';
function setup(){const config=configFor();config.loadPlan.slos=[{id:'checks',metric:'checks',stat:'rate',operator:'>',value:.99}];return fixture(config);}
it('uses sampled native checks pass/fail including optional workload assertions',()=>{
 const input=setup();const metric=input.summary!.metrics.checks!;metric.values={rate:1,passes:6,fails:0};threshold(input,'checks','rate>0.99',true);
 expect(mapK6Result(input)).toMatchObject({ok:true,body:{outcome:'passed',thresholds:[{id:'checks',passed:true,reading:{source:'native-summary',metric:'checks',stat:'rate',value:1}}]}});
 metric.values={rate:2/3,passes:4,fails:2};count(input,'beetle_assertion_failures{assertion:a1}',2);threshold(input,'checks','rate>0.99',false);input.process.exitCode=99;
 expect(mapK6Result(input)).toMatchObject({ok:true,body:{outcome:'failed',requiredAssertions:{failed:0},thresholds:[{id:'checks',passed:false,reading:{value:2/3}}]}});
});
it('never grants a checks verdict from an empty native denominator or missing statistic',()=>{
 const input=setup();input.summary!.metrics.checks!.values={rate:0,passes:0,fails:0};threshold(input,'checks','rate>0.99',true);
 expect(mapK6Result(input)).toMatchObject({ok:true,body:{outcome:'inconclusive',completeness:'partial',thresholds:[]}});
 input.summary!.metrics.checks!.values={passes:1,fails:0};expect(mapK6Result(input)).toMatchObject({ok:true,body:{outcome:'inconclusive',thresholds:[]}});
});
