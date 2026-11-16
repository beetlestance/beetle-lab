import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {readDeliveryJson} from '../../../delivery/files.js';
import {record} from '../../resources/values.js';
import {sample} from '../load/measure.js';
import {captureRss} from '../rss/capture.js';
import type {DockerTransport} from '../../../../agent/src/backends/docker/index.js';
const execute=promisify(execFile);
interface Input {context:string;id:string;markerPath:string;transport:DockerTransport;terminal:()=>boolean;environment:(index:number,runtimeId:string,mode:string)=>void;failed:()=>void}
async function marker(path:string){
 try{return record(await readDeliveryJson(path));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
}
function active(value:Record<string,unknown>|null){
 if(value?.phase!=='active')return null;
 assert(typeof value.index==='number'&&Number.isInteger(value.index)&&value.index>=0&&value.index<10);
 assert(value.mode==='on'||value.mode==='off');assert(typeof value.runtimeId==='string');
 return {index:value.index,mode:value.mode,runtimeId:value.runtimeId};
}
async function point(input:Input,before:NonNullable<ReturnType<typeof active>>){
 const env:NodeJS.ProcessEnv={...process.env,DOCKER_API_VERSION:'1.47'};delete env.DOCKER_HOST;delete env.DOCKER_CONTEXT;
 let outcome:Awaited<ReturnType<typeof sample>>;let rss:ReturnType<typeof captureRss>;
 try{
  const values=await Promise.allSettled([sample(input.transport,input.id),execute('docker',['--context',input.context,'top',input.id,'-eo','pid,rss'],{env,timeout:10000,maxBuffer:65536,encoding:'utf8'})]);
  const first=values[0]!;const second=values[1]!;assert(first.status==='fulfilled'&&second.status==='fulfilled');
  outcome=first.value;rss=captureRss(second.value.stdout);
 }catch(error){if((await marker(input.markerPath))?.phase==='finished')return null;throw error;}
 const after=await marker(input.markerPath);if(after?.phase!=='active'||after.index!==before.index)return null;
 return {index:before.index,mode:before.mode,...outcome,...rss};
}
function checkStartup(input:Input,captured:Record<string,unknown>|null,seen:boolean,started:number){
 const present=seen||captured!==null;
 if(!present&&performance.now()-started>=30000){input.failed();throw Error('Qualification startup marker deadline');}
 if(captured?.phase==='finished'&&captured.status==='failed'){input.failed();throw Error('Component reported failed drain or execution');}
 return present;
}
export async function observe(input:Input){
 assert(/^[a-f0-9]{64}$/.test(input.id));const points=[];const verified=new Set<number>();const started=performance.now();const deadline=started+480000;let markerSeen=false;
 for(let n=0;n<480&&!input.terminal();n++){
  assert(performance.now()<deadline);const captured=await marker(input.markerPath);markerSeen=checkStartup(input,captured,markerSeen,started);
  const before=active(captured);
  if(before){
   if(before.index<2&&!verified.has(before.index)){input.environment(before.index,before.runtimeId,before.mode);verified.add(before.index);}
   const observed=await point(input,before);if(observed){assert(points.length<480);points.push(observed);}
  }
  await delay(1000);
 }
 assert(input.terminal(),'Observation deadline');assert.deepEqual([...verified].sort(),[0,1]);return points;
}
export type Point=Awaited<ReturnType<typeof observe>>[number];
