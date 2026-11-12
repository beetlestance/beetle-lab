import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
/** Task-only process diagnostics; no user configuration or credentials are printed. */
export function composeProcesses(context:string,args:string[],root:string){
 const environment:NodeJS.ProcessEnv={...process.env,DOCKER_API_VERSION:'1.47'};
 delete environment.DOCKER_HOST;delete environment.DOCKER_CONTEXT;
 let sequence=0;
 const compose=(...command:string[])=>{
  const log=join(root,`compose-${++sequence}-${command[0]}.log`);
  try{return execFileSync('docker',['--context',context,...args,...command],{env:environment,encoding:'utf8',timeout:60000,maxBuffer:2097152,stdio:['pipe','pipe','pipe']}).trim();}
  catch(error){const failure=error as {stderr?:Buffer|string;stdout?:Buffer|string;status?:number};
   writeFileSync(log,JSON.stringify({status:failure.status,stdout:String(failure.stdout??'').slice(-65536),stderr:String(failure.stderr??'').slice(-65536)}),{mode:0o600});
   throw Error(`Compose ${command[0]} failed; private diagnostics: ${log}`,{cause:error});
  }
 };
 const logs=(id:string)=>{
  assert(/^[a-f0-9]{64}$/.test(id));
  const result=spawnSync('docker',['--context',context,'logs','--tail','100',id],{env:environment,encoding:'utf8',timeout:10000,maxBuffer:2097152});
  assert.equal(result.error,undefined);assert.equal(result.status,0);return result.stdout+result.stderr;
 };
 return {compose,logs};
}
