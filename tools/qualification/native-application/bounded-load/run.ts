/** Four finite runs in one unchanged installation; no history purge or pool enlargement. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {UnixDockerTransport} from '../../../../agent/src/backends/docker/index.js';
import {automaticSession,readReadyPublic} from '../compose/public.js';
import {cleanup,controlBudget} from '../compose/evidence.js';
import {cleanupLiveVolumes} from '../live-volumes.js';
import {saveRevision,value} from '../public-api.js';
import {idle,loaded} from '../load/observe.js';
import {candidate} from '../load/candidate.js';
import {observeRss,summarizeRss} from '../rss/observe.js';
import {stopForCustody,ledger} from '../../resources/lifecycle/observations.js';
import type {Run} from '@beetle/contracts/api';
import {configuration} from './config.js';
import {target} from './target.js';
import {final} from './final.js';
import {memoryFacts} from './memory.js';
const [bundlePath,output,context='default',extra]=process.argv.slice(2);
assert(bundlePath&&output&&isAbsolute(bundlePath)&&isAbsolute(output)&&!extra);
const config=await configuration();const {f,identities}=await candidate(bundlePath,context,2048);
await mkdir(output,{mode:0o700});await writeFile(join(output,'owner.json'),JSON.stringify({root:f.root,project:f.project,revision:f.revision,owner:randomUUID()}),{flag:'wx',mode:0o600});
let installation:string|undefined;let phase='startup';let status='failed';const results:Record<string,unknown>={};const runs:Run[]=[];
try{
 const oracle=await target(f);results.targetSourceSha256=oracle.sourceSha256;
 f.compose('up','-d','--no-build');const session=await automaticSession(f.origin,undefined,1024);
 const client={...session,installation:await readReadyPublic(signal=>session.api.getInstallationSettings({signal}))};installation=client.installation.id;
 await writeFile(join(output,'installation-owner.json'),JSON.stringify({project:f.project,installationId:installation}),{flag:'wx',mode:0o600});
 results.controlReserve=controlBudget(f);results.settingsBefore=client.installation;
 const peers=['frontend','backend','agent'].map(role=>{const id=f.compose('ps','-q',role);assert(/^[a-f0-9]{64}$/.test(id));
  const row=f.docker.json<{HostConfig:{Memory:number};RestartCount:number;State:{Running:boolean;StartedAt:string}}[]>(['inspect',id])[0]!;assert(row.State.Running&&row.RestartCount===0);return {role,id,memory:row.HostConfig.Memory,startedAt:row.State.StartedAt};});
 const endpoint=f.docker.run(['context','inspect',context,'--format','{{.Endpoints.docker.Host}}']);assert(endpoint.startsWith('unix://'));const transport=new UnixDockerTransport(endpoint.slice(7));
 const subscribers=await Promise.all([0,1,2].map(()=>automaticSession(f.origin)));
 const saved=await saveRevision(client.api,{offer:{config}});const trials:Record<string,unknown>[]=[];results.trials=trials;
 for(let index=0;index<4;index++){
  const trial:Record<string,unknown>={index,warmup:index===0};trials.push(trial);let window='idle';const observer=observeRss(context,peers,()=>window);let observerFailure:{error:unknown}|undefined;
  try{
   phase='idle';trial.idle=await idle(peers,transport,client.api,part=>{trial.idlePartial=part;});
   const queued=value(await client.api.createRun({params:saved.params,body:{scope:saved.scope,requestId:randomUUID(),revisionId:saved.revision.id,engineProfile:'k6-local',
    budget:{...client.installation.values.runDefaults.budget,outputBytes:8388608},executionPolicy:{mode:'parallel',preferIdle:false}}}));runs.push(queued);
   phase='loaded';window='loaded';trial.loaded=await loaded(peers,transport,{api:client.api,subscribers:subscribers.map(item=>item.api),queued,checkpoint:part=>{trial.loadedPartial=part;}});
   phase='final';window='final';trial.final=await final(client,queued,part=>{trial.finalDrain=part;});trial.target=await oracle.counts();
   assert.deepEqual({...trial.target as Record<string,unknown>,unique:0},{ready:index+1,work:(index+1)*400,unexpected:0,unique:0});
   assert((trial.target as {unique:number}).unique>=64);
   phase='post-idle';window='post-idle';const postIdleWindows:Awaited<ReturnType<typeof idle>>[]=[];trial.postIdleWindows=postIdleWindows;
   for(let n=0;n<4;n++)postIdleWindows.push(await idle(peers,transport,client.api,part=>{trial.postIdlePartial=part;}));
  }finally{
   try{const points=await observer.close();trial.rssPoints=points;trial.processRss=summarizeRss(points,peers);}
   catch(error){trial.rssFailure=String(error instanceof Error?error.stack:error).slice(0,1024);observerFailure={error};}
  }
  if(observerFailure)throw observerFailure.error;
 }
 results.settingsAfter=await readReadyPublic(signal=>client.api.getInstallationSettings({signal}));assert.deepEqual(results.settingsAfter,results.settingsBefore);
 for(const peer of peers){const row=f.docker.json<{RestartCount:number;State:{Running:boolean;StartedAt:string}}[]>(['inspect',peer.id])[0]!;
  assert(row.State.Running&&row.RestartCount===0);assert.equal(row.State.StartedAt,peer.startedAt);}
 results.unchangedInstallation=true;results.memory=memoryFacts(trials);
 phase='custody';stopForCustody(f);results.retained=runs.map(run=>ledger(f,run,installation!));
 assert((results.memory as ReturnType<typeof memoryFacts>).met,'Repeated memory or latency acceptance target missed');status='passed';
}catch(error){process.exitCode=1;await writeFile(join(output,'failure-private.txt'),String(error instanceof Error?error.stack:error).slice(0,16384),{flag:'wx',mode:0o600});}
finally{
 let cleanupVerified=false;try{await cleanup(f,installation);if(installation)cleanupLiveVolumes({id:installation,user:'1000:1000',docker:f.docker});cleanupVerified=true;}catch{status='failed';process.exitCode=1;}
 await writeFile(join(output,'outcome-private.json'),JSON.stringify({status,phase,cleanupVerified,sourceRevision:f.revision,architecture:f.architecture,harnessNode:process.version,environment:f.environment,imageIds:f.imageIds,archiveIdentities:identities,results},null,2),{flag:'wx',mode:0o600});
 console.log(JSON.stringify({status,phase,cleanupVerified}));
}
