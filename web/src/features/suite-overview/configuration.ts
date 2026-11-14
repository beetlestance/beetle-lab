const executors=new Set(['constant-arrival-rate','ramping-arrival-rate','ramping-vus','constant-vus','shared-iterations','per-vu-iterations','ramp-until']);
function record(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function duration(value:unknown):string|null{return typeof value==='string'&&value.length<=12&&/^(0|[1-9][0-9]{0,8})(ms|s|m|h)$/.test(value)?value:null;}
function origin(value:unknown):string|null{
 if(typeof value!=='string'||value.length>2048)return null;
 try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&url.origin.length<=512?url.origin:null;}catch{return null;}
}
const unknownTiming='Configured timing unavailable';
function literalTiming(label:string,value:unknown):string{const time=duration(value);return time===null?unknownTiming:`${label} ${time}`;}
function stageTiming(stages:unknown):string{
 if(!Array.isArray(stages)||stages.length===0||stages.length>128)return unknownTiming;
 const times=stages.slice(0,6).map(stage=>record(stage)?duration(stage.duration):null);
 if(times.some(time=>time===null))return unknownTiming;
 return `${stages.length} stages: ${times.join(', ')}${stages.length>6?' …':''}`;
}
function timing(value:Record<string,unknown>):string{
 switch(value.executor){
  case 'constant-arrival-rate':case 'constant-vus':return literalTiming('Workload',value.duration);
  case 'shared-iterations':case 'per-vu-iterations':return literalTiming('Iteration limit',value.maxDuration);
  case 'ramping-arrival-rate':case 'ramping-vus':return stageTiming(value.stages);
  case 'ramp-until':{const time=duration(value.stepDuration);return time===null?unknownTiming:`Discovery steps ${time}; stopping depends on the plan`;}
  default:return unknownTiming;
 }
}
function configuredScenarios(config:Record<string,unknown>):unknown[]|null{
 const plan=config.loadPlan;
 if(config.version!==1||!record(plan)||plan.version!==1||!Array.isArray(plan.scenarios)||plan.scenarios.length>64)return null;
 return plan.scenarios;
}
function scenario(value:unknown){
 if(!record(value)||typeof value.executor!=='string'||!executors.has(value.executor))return null;
 return {executor:value.executor,timing:timing(value),offset:duration(value.startTime),grace:duration(value.gracefulStop)};
}
export function configurationSummary(config:Record<string,unknown>){
 const scenarios=configuredScenarios(config);const rows=scenarios?.slice(0,8).map(scenario)??[];
 return {origin:origin(config.target),rows,remaining:scenarios?Math.max(0,scenarios.length-8):0,available:scenarios!==null&&rows.length>0};
}
