import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { changeInstalledMemory } from '../capacity/index.js';
import { native } from '../src/files.js';
import { openBackendServing } from '../../../app/src/bootstrap/recovery-control/index.js';
import { openServingState } from '../../../agent/src/installation-state/index.js';
import type { ProvisionRequest, ProvisionContext } from '../types.js';
import type { DockerReply } from '../../../agent/src/backends/docker/index.js';
const raw=JSON.parse(await readFile(process.argv[2]!,'utf8')) as {input:{request:ProvisionRequest;operationId:string;memoryBytes:number};agentWorker:string;backendWorker:string};
const root=raw.input.request.root;
const config=JSON.parse(await readFile(join(root,'config/agent.json'),'utf8'));
const docker:ProvisionContext['docker']={async request(input):Promise<DockerReply>{
 if(input.path==='/v1.47/info')return {ok:true,status:200,body:{ID:config.installation.expectedDaemonId,OSType:'linux',Architecture:'aarch64',DefaultRuntime:'runc'}};
 if(input.path.startsWith('/v1.47/images/'))return {ok:true,status:200,body:{Id:input.path.includes('agent')?config.installation.agentImageId:config.engines[0].profile.imageDigest,
  Os:'linux',Architecture:'arm64',Config:{Env:config.engines[0].profile.effectiveImage.environment}}};
 if(input.path.startsWith('/v1.47/networks/'))return {ok:true,status:200,body:{Name:raw.input.request.targetNetwork}};
 if(input.path.startsWith('/v1.47/containers/json?'))return {ok:true,status:200,body:[]};
 return {ok:true,status:200,body:{Id:'a'.repeat(64),Image:config.installation.agentImageId,
  State:{Status:'exited',Running:false,Restarting:false,Dead:false,Pid:0},Config:{Env:[`BEETLE_AGENT_CONFIG_FILE=${join(root,'config/agent.json')}`]}}};
}};
let armed=false;const open=native.open;const rename=native.rename;
native.open=async(path,flags,mode)=>{
 const handle=await open(path,flags,mode);
 if(String(path)!==join(root,'config'))return handle;
 return new Proxy(handle,{get(target,key){
  if(key==='close')return async()=>{if(armed){armed=false;throw new Error('synthetic nested close failure');}await target.close();};
  const value=Reflect.get(target,key,target) as unknown;return typeof value==='function'?value.bind(target):value;
 }});
};
native.rename=async(from,to)=>{await rename(from,to);if(String(from).includes(`${raw.input.operationId}-prepare`))armed=true;};
const context=():ProvisionContext=>({docker,agentWorkerUrl:new URL(raw.agentWorker),backendWorkerUrl:new URL(raw.backendWorker),
 signal:new AbortController().signal,deadline:performance.now()+30000});
let code='unexpected';try{await changeInstalledMemory(raw.input,context());}catch(error){code=String((error as {code?:unknown}).code);}
function owned(open:()=>{close():void}){try{open().close();return false;}catch(error){return (error as {code?:unknown}).code==='owned';}}
const backendOwned=owned(()=>openBackendServing(join(root,'backend/recovery-control.sqlite'),config.installation.installationId));
const agentOwned=owned(()=>openServingState(join(root,'agent/journal/journal.sqlite.authority.sqlite')));
let repeatRefused=false;try{await changeInstalledMemory(raw.input,context());}catch(error){repeatRefused=(error as {code?:unknown}).code==='conflict';}
const phase=JSON.parse(await readFile(join(root,'config/configuration-state.json'),'utf8')).phase;
process.stdout.write(JSON.stringify({code,backendOwned,agentOwned,repeatRefused,phase})+'\n');
