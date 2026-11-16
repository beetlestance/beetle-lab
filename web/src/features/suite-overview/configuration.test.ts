import {expect,it} from 'vitest';
import {configurationSummary} from './configuration.js';
it('projects configured source durations for every executor without claiming measured or total runtime',()=>{
 const config={version:1,target:'https://name:SECRET@target.invalid/base?token=SECRET#fragment',loadPlan:{version:1,scenarios:[
  {executor:'constant-arrival-rate',duration:'10s',startTime:'0s',gracefulStop:'2s'},
  {executor:'constant-vus',duration:'20s'},
  {executor:'shared-iterations',maxDuration:'30s'},
  {executor:'per-vu-iterations',maxDuration:'40s'},
  {executor:'ramping-arrival-rate',stages:[{duration:'5s'},{duration:'10s'}]},
  {executor:'ramping-vus',stages:[{duration:'15s'}]},
  {executor:'ramp-until',stepDuration:'6s'},
 ]}};
 const before=structuredClone(config);const result=configurationSummary(config);
 expect(result.origin).toBe('https://target.invalid');expect(JSON.stringify(result)).not.toContain('SECRET');
 expect(result.rows.map(row=>row?.timing)).toEqual(['Workload 10s','Workload 20s','Iteration limit 30s','Iteration limit 40s','2 stages: 5s, 10s','1 stages: 15s','Discovery steps 6s; stopping depends on the plan']);
 expect(config).toEqual(before);
});
it('bounds scenario/stage displays and never reads request bodies or secret bindings',()=>{
 const config={version:1,target:'http://target.invalid',loadPlan:{version:1,scenarios:Array.from({length:64},()=>({executor:'ramping-vus',stages:Array.from({length:128},()=>({duration:'1s'}))}))},
  get requests(){throw Error('Must not read request payload');},get secrets(){throw Error('Must not resolve secrets');}};
 const summary=configurationSummary(config);expect(summary.rows).toHaveLength(8);expect(summary.remaining).toBe(56);
 expect(summary.rows[0]?.timing).toContain('128 stages:');expect(summary.rows[0]?.timing).toContain('…');
 expect(configurationSummary({version:1,loadPlan:{version:1,scenarios:Array(65).fill({})}}).available).toBe(false);
});
it('keeps absent, malformed and unsupported configuration unknown',()=>{
 expect(configurationSummary({version:1,target:'file:///private',loadPlan:{version:2,scenarios:[]}})).toMatchObject({origin:null,available:false});
 expect(configurationSummary({version:1,loadPlan:{version:1,scenarios:[{executor:'unknown'}]}}).rows).toEqual([null]);
 expect(configurationSummary({version:1,loadPlan:{version:1,scenarios:[{executor:'constant-vus',duration:'SECRET'}]}}).rows[0]?.timing).toBe('Configured timing unavailable');
});
