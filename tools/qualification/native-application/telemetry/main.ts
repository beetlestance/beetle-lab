import assert from 'node:assert/strict';
import {dirname,join} from 'node:path';
import {writeFile,rename} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {encodeJson} from '@beetle/contracts';
import {loadAgentConfiguration} from '../../../../agent/src/bootstrap/configuration.js';
import {assemble} from './assembly.js';
import type {Assembly} from './assembly.js';
import {runTrial} from './trial.js';
import {hasUncertainOwners,retain} from './ownership.js';
import {diagnosis} from './diagnosis.js';
import {privateReport} from './report.js';
import {modes} from './config.js';
async function atomic(path:string,value:unknown,maximum:number){
 const temporary=path+'.next';await writeFile(temporary,encodeJson(value,maximum),{flag:'wx',mode:0o600});await rename(temporary,path);
}
/** Runs only inside the owned qualification overlay, after the normal identity drop. */
async function main(){
 assert.equal(process.platform,'linux');assert.equal(process.pid,1);assert.equal(process.getuid!(),1000);
 const loaded=await loadAgentConfiguration(process.env,pathToFileURL('/beetle/agent/worker.js'));
 const directory=dirname(loaded.runtime.journal.path);const marker=join(directory,'telemetry-marker.json');const path=join(directory,'telemetry-report.json');
 const results:unknown[]=[];let assembly:Assembly|undefined;let status:'passed'|'failed'='failed';let failure:string|undefined;
 try{
  await atomic(marker,{phase:'initializing'},512);
  assembly=await assemble(loaded.runtime,value=>atomic(join(directory,'telemetry-startup.json'),value,4096));
  for(const [index,mode] of modes.entries()){
   await atomic(marker,{phase:'starting',index,mode},512);
   const result=await runTrial({assembly,options:loaded.runtime,index,mode,mark:value=>atomic(marker,value,512)});results.push(result);
   console.log(JSON.stringify({kind:'telemetry.completed',index,mode,wallMs:result.wallMs}));
  }status='passed';
 }catch(error){failure=diagnosis(error);process.exitCode=1;}
 try{await assembly?.close();assert(!hasUncertainOwners(),'Uncertain owners retain configuration custody');await loaded.close();}catch(error){retain({assembly,loaded});status='failed';process.exitCode=1;failure=(failure?failure+'\nTeardown: ':'')+diagnosis(error);}
 await atomic(marker,{phase:'finished',status},512);
 await atomic(path,privateReport({status,installationId:loaded.runtime.installation.installationId,agentPid:process.pid,agentUid:process.getuid!(),orderlyDrained:!hasUncertainOwners(),results,failure}),262144);
}
void main().catch(()=>{console.error('Qualification telemetry assembly failed');process.exitCode=1;});
