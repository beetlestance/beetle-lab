import assert from 'node:assert/strict';
import {readFile,writeFile,copyFile,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import type {Fixture} from '../../../../agent/test/container/fixture.js';
import {agentOrigin} from '../configuration.js';
export function currentOrigin(f:Fixture):string{return agentOrigin(f.docker.run(['port',f.agent,'4312/tcp']));}
export function killAgent(f:Fixture):void{const value=f.docker.json<{State:{Running:boolean}}[]>(['inspect',f.agent])[0]!;if(value.State.Running)f.docker.run(['kill','--signal','KILL',f.agent]);}
export function restartAgent(f:Fixture):void{f.docker.run(['start',f.agent]);}
export async function startDockerSidecar(f:Fixture,runtimeId:string){
 f.docker.run(['stop','-t','10',f.agent]);assert.equal(f.docker.json<{State:{ExitCode:number}}[]>(['inspect',f.agent])[0]!.State.ExitCode,0);
 const socket=join(f.root,'config','d.sock');assert(Buffer.byteLength(socket)<108);const name=`beetle-cleanup-proxy-${f.id}`;
 const source=resolve('.agent-work/docker-proxy.mjs');const info=await stat(source);assert(info.isFile()&&info.size<=1048576);
 await copyFile(source,join(f.root,'config','proxy.mjs'));
 f.docker.run(['run','-d','--pull','never','--name',name,'--label',`dev.beetle.qualification=${f.id}`,'--network','none','--user',f.user,'--group-add','0',
  '--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--cpus','0.5','--memory','128m','--pids-limit','64',
  '--log-driver','local','--log-opt','max-size=1m','--log-opt','max-file=2','--mount',`type=bind,src=${join(f.root,'config')},dst=/control`,
  '--mount','type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock','--entrypoint','node',f.agentImage.Id,'/control/proxy.mjs',f.id,runtimeId,f.engine]);
 await waitFor(async()=>{try{return (await stat(socket)).isSocket();}catch{return false;}},'Docker proxy socket did not appear');
 const configInfo=await stat(f.configPath);assert(configInfo.size<=65536);const config=JSON.parse(await readFile(f.configPath,'utf8')) as {dockerSocket:string};
 assert.equal(config.dockerSocket,'/var/run/docker.sock');config.dockerSocket=socket;await writeFile(f.configPath,JSON.stringify(config),{mode:0o600});restartAgent(f);
 return {name,async marker(){let result:unknown;await waitFor(async()=>{try{const path=join(f.root,'config','runtime-removed.json');assert((await stat(path)).size<=256);result=JSON.parse(await readFile(path,'utf8')) as unknown;return true;}catch{return false;}},'No settled Docker deletion marker');
   assert(result&&typeof result==='object');assert.equal(Reflect.get(result,'runtimeId'),runtimeId);assert.equal(Reflect.get(result,'installationId'),f.id);return result;
  },close(){f.docker.run(['stop','-t','10',name]);assert.equal(f.docker.json<{State:{ExitCode:number}}[]>(['inspect',name])[0]!.State.ExitCode,0);
   const lines=f.docker.run(['logs',name]).split('\n');assert(lines.length<=8);const final=JSON.parse(lines.at(-1)!) as {active:number;sockets:number;faulted:boolean;failures:number;refused:number};
   assert.equal(final.active,0);assert.equal(final.sockets,0);assert.equal(final.faulted,true);assert.equal(final.failures,0);assert.equal(final.refused,0);return final;
  }};
}
export async function waitFor(probe:()=>Promise<boolean>,label:string):Promise<void>{
 const end=performance.now()+10000;for(let attempts=0;attempts<200&&performance.now()<end;attempts++){if(await probe())return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error(label);
}
