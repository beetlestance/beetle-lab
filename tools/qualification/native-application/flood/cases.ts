import assert from 'node:assert/strict';
import type {ApiClient,Run} from '@beetle/contracts/api';
import type {Fixture} from '../compose/fixture.js';
import {pause,value} from '../public-api.js';
import {readFailed} from '../load/observe.js';
import {runningRuntime} from '../../resources/lifecycle/observations.js';
export const params=(run:Run)=>({organizationId:run.scope.organizationId,workspaceId:run.scope.workspaceId,runId:run.id});
export async function started(api:ApiClient,f:Fixture,run:Run,installation:string,pressure:{count:()=>Promise<{work:number}>;before:number}){
 const deadline=performance.now()+45000;let refused=0;
 for(let n=0;n<160&&performance.now()<deadline;n++){
  const response=await api.getRun({params:params(run)});if(readFailed(response)){refused++;await pause();continue;}const current=value(response);
  assert(!['finished','errored','cancelled'].includes(current.state),'Run ended before pressure checkpoint');
  const native=runningRuntime(f,run,installation);const physical=await pressure.count();
  if(native&&physical.work-pressure.before>=64)return {native,refused,work:physical.work-pressure.before};await pause();
 }throw Error('Physical metric-pressure checkpoint unavailable');
}
export async function terminal(api:ApiClient,run:Run){
 const deadline=performance.now()+60000;let refused=0;
 for(let n=0;n<200&&performance.now()<deadline;n++){
  const reply=await api.getRun({params:params(run)});if(readFailed(reply)){refused++;await pause();continue;}const current=value(reply);
  if(['finished','errored','cancelled'].includes(current.state))return {run:current,refused};await pause();
 }throw Error('Pressure Run did not reach terminal state');
}
export async function stopped(f:Fixture,id:string){
 const deadline=performance.now()+20000;
 for(let n=0;n<64&&performance.now()<deadline;n++){
  const rows=f.docker.json<{Id:string;State:{Running:boolean;ExitCode:number;OOMKilled:boolean}}[]>(['inspect',id]);assert.equal(rows.length,1);assert.equal(rows[0]!.Id,id);
  if(!rows[0]!.State.Running){assert.equal(rows[0]!.State.OOMKilled,false);return {exitCode:rows[0]!.State.ExitCode,oomKilled:false};}await pause();
 }throw Error('Pressure runtime did not physically stop');
}
export async function events(api:ApiClient,run:Run){
 const page=value(await api.listRunEvents({params:params(run),query:{limit:100}}));assert.equal(page.generation,1);assert.equal(page.blockedReason,null);assert.equal(page.nextCursor,null);
 const exited=page.items.filter(event=>event.kind==='runtime.exited');assert.equal(exited.length,1);
 return {exit:exited[0]!.payload,resourceSummaries:page.items.filter(event=>event.kind==='resource.summary').map(event=>event.payload),events:page.items.length};
}
export function held(state:{destroyed:boolean;complete:boolean;ended:boolean;bufferedBytes:number}){assert(!state.destroyed&&!state.complete&&!state.ended&&state.bufferedBytes<=65536);return state;}
