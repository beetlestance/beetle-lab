import { expect, it } from 'vitest';
import { scenarioIntents } from '../../src/application/run-comparison/scenario-intent.js';
import type { ComparisonScenario } from '../../src/application/run-comparison/source.js';
import { fixture, context } from './fixture.js';
const scenarios:ComparisonScenario[]=[
 {id:'fixed',executor:'constant-arrival-rate',rate:1200,timeUnit:'2s',preAllocatedVUs:24,maxVUs:48},
 {id:'ramping',executor:'ramping-arrival-rate',startRate:20,stages:[{target:100},{target:40}],timeUnit:'1s',preAllocatedVUs:5,maxVUs:20},
 {id:'until',executor:'ramp-until',startRate:10,maxRate:500,timeUnit:'1m',preAllocatedVUs:2,maxVUs:30},
 {id:'vu-ramp',executor:'ramping-vus',startVUs:0,stages:[{target:20},{target:0}]},
 ...(['constant-vus','shared-iterations','per-vu-iterations'] as const).map(executor=>({id:executor,executor,vus:7})),
];
it('projects all7executors without pooling sources or converting time units',()=>{
 const values=scenarioIntents(scenarios);expect(values).toHaveLength(7);
 expect(values[0]).toMatchObject({arrivalRate:{initial:1200,maximum:1200,timeUnit:'2s'},vus:{initial:24,maximum:48}});
 expect(values[1]).toMatchObject({arrivalRate:{initial:20,maximum:100,timeUnit:'1s'}});
 expect(values[2]).toMatchObject({arrivalRate:{initial:10,maximum:500,timeUnit:'1m'}});
 expect(values[3]).toMatchObject({arrivalRate:null,vus:{initial:0,maximum:20}});
 expect(values.slice(4).every(s=>s.arrivalRate===null&&s.vus.initial===7&&s.vus.maximum===7)).toBe(true);
});
it('keeps engine-rejected allocation intent readable without extra IO or private config values',async()=>{
 const f=fixture();const run=[...f.runs.values()][0]!;const config=f.revisions.get(run.revisionId)!.config as {loadPlan:{scenarios:unknown[]}};
 config.loadPlan.scenarios=[{id:'main',name:'PRIVATE_SCENARIO_NAME',executor:'constant-arrival-rate',startTime:'0s',gracefulStop:'0s',rate:1200,timeUnit:'2s',duration:'1m',preAllocatedVUs:20,maxVUs:10}];f.config(0).requests[0]!.headers['X-Private']='PRIVATE_HEADER_VALUE';f.repin(0);run.state='errored';run.outcome='inconclusive';f.results.get(run.id)!.result=null;
 const value=await f.service().compare(f.request,context());expect(value.items[0]!.scenarioIntents).toEqual([{id:'main',executor:'constant-arrival-rate',arrivalRate:{initial:1200,maximum:1200,timeUnit:'2s'},vus:{initial:20,maximum:10}}]);
 expect(JSON.stringify(value)).not.toMatch(/PRIVATE_SCENARIO_NAME|PRIVATE_HEADER_VALUE/);expect(f.calls.filter(call=>call.startsWith('revision:'))).toHaveLength(4);
});

it('drops optional intent even without a native result and keeps the original reply cap',async()=>{
 const {validateApi,RUN_COMPARISON_BYTES}=await import('@beetle/contracts/api');const {encodeComparison}=await import('../../src/application/run-comparison/serialize.js');const data=(await import('../../../contracts/fixtures/api/valid/run-comparison.json',{with:{type:'json'}})).default;
 const checked=validateApi('RunComparisonSnapshot',data);if(!checked.ok)throw Error('Invalid comparison fixture');const value=structuredClone(checked.value);const item=value.items[0]!;
 item.result=null;item.scenarioIntents=Array.from({length:64},(_,i)=>({id:'s'+i,executor:'constant-vus',arrivalRate:null,vus:{initial:1,maximum:1}}));
 const bytes=Buffer.byteLength(JSON.stringify(value));item.run.note='x'.repeat(RUN_COMPARISON_BYTES-bytes+80);
 const encoded=encodeComparison(value);expect(Buffer.byteLength(encoded)).toBeLessThanOrEqual(RUN_COMPARISON_BYTES);expect(JSON.parse(encoded).items[0].scenarioIntents).toBeUndefined();expect(item.scenarioIntents).toHaveLength(64);
 item.run.note='x'.repeat(RUN_COMPARISON_BYTES);expect(()=>encodeComparison(value)).toThrow('request_limit');
});
