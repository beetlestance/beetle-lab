import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createK6ConfigSchema} from '@beetle/contracts/engine-config/k6';
import type {SuiteConfig} from '../../../../engines/k6/compiler/suite/index.js';
export const modes=['off','on','off','on','on','off','off','on','on','off'] as const;
export type Mode=typeof modes[number];
export function configuration():SuiteConfig{
 const config:SuiteConfig={version:1,target:'http://target:8080',secrets:[],datasets:[],
  requests:[{id:'work',name:'Fixed work',method:'GET',path:'/work',headers:{},query:{},
   assertions:Array.from({length:4},(_,index)=>({id:'a'+index,kind:'statusEq' as const,value:200,required:true}))}],
  readiness:{path:'/ready',attempts:1,intervalMs:0,timeoutMs:1000,wallBudgetMs:1000,expectedStatus:200,assertions:[]},
  loadPlan:{version:1,scenarios:[{id:'main',name:'Fixed_iterations',executor:'per-vu-iterations',vus:4,iterations:1000,maxDuration:'30s',startTime:'0s',gracefulStop:'0s'}],slos:[]},
  selections:[{scenarioId:'main',entries:[{requestId:'work',weight:1,wait:{durationMs:0,jitterMs:0}}]}]};
 assert(createK6ConfigSchema(value=>createHash('sha256').update(value).digest('hex')).validate(config));return config;
}
