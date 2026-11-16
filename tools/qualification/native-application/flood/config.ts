import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createK6ConfigSchema} from '@beetle/contracts/engine-config/k6';
import {k6MetricLayout} from '@beetle/contracts/k6-metrics';
import type {SuiteConfig} from '../../../../engines/k6/compiler/suite/index.js';
export function configuration():SuiteConfig{
 const ids=['r0','r1','r2','r3'];const config:SuiteConfig={version:1,target:'http://target:8080',secrets:[],datasets:[],
  requests:ids.map(id=>({id,name:'Controlled response '+id,method:'GET',path:'/work/'+id,headers:{},query:{},
   assertions:Array.from({length:48},(_,index)=>({id:'a'+index,kind:'statusEq' as const,value:200,required:true}))})),
  readiness:{path:'/ready',attempts:1,intervalMs:0,timeoutMs:1000,wallBudgetMs:1000,expectedStatus:200,assertions:[]},
  loadPlan:{version:1,scenarios:[{id:'main',name:'Bounded_metric_pressure',executor:'per-vu-iterations',vus:4,iterations:1000,maxDuration:'30s',startTime:'0s',gracefulStop:'0s'}],slos:[]},
  selections:[{scenarioId:'main',entries:ids.map(requestId=>({requestId,weight:1,wait:{durationMs:20,jitterMs:0}}))}]};
 assert(createK6ConfigSchema(value=>createHash('sha256').update(value).digest('hex')).validate(config));assert.equal(k6MetricLayout(config).labelSets,198);return config;
}
