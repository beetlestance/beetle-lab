import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import type {Scope} from '../../../../agent/src/admission/index.js';
import type {Trial} from './assembly.js';
export function readers(trial:Trial,key:Scope,enabled:boolean){
 const stop=new AbortController();let failure:unknown;
 const observations=Array.from({length:3},()=>({calls:0,frames:0,unavailable:0,lastPublished:0}));
 const jobs=enabled?observations.map(async row=>{
  try{while(!stop.signal.aborted){
   assert(++row.calls<=40);const result=await trial.supervisor.readLiveMetrics(key,{deadline:performance.now()+1000,signal:stop.signal});
   if(result.ok){if(result.frame.publishedSequence>row.lastPublished){row.frames++;row.lastPublished=result.frame.publishedSequence;}}
   else{assert(['busy','unavailable','stale','aborted','closed','deadline'].includes(result.reason));row.unavailable++;}
   await delay(2000,undefined,{signal:stop.signal}).catch(error=>{if(!stop.signal.aborted)throw error;});
  }}catch(error){failure??=error;stop.abort();}
 }):[];
 return {async close(){stop.abort();await Promise.allSettled(jobs);if(failure)throw failure;return observations;}};
}
