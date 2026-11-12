import assert from 'node:assert/strict';
import {writeFile,mkdtemp,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {composeProcesses} from './process.js';
import type {Image,Daemon} from '../../../../agent/test/container/docker.js';
import {Docker} from '../../../../agent/test/container/docker.js';
import {ownedOrigin} from '../public-api.js';
export async function fixture(argv:string[]){
 const [frontend,backend,agent,installer,engine,offline,context='default']=argv;
 assert(argv.length>=6&&argv.length<=7);for(const item of [frontend,backend,agent,installer,engine,offline])assert(item&&/^[a-zA-Z0-9][a-zA-Z0-9_./:@-]{0,255}$/.test(item));
 assert(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(context));
 const docker=new Docker(context,2);const info=docker.json<Daemon>(['info','--format','{{json .}}']);assert.equal(info.OSType,'linux');
 const architecture=info.Architecture==='aarch64'?'arm64':info.Architecture==='x86_64'?'amd64':info.Architecture;assert(['arm64','amd64'].includes(architecture));
 const inspected=docker.json<Image[]>(['image','inspect',frontend!,backend!,agent!,installer!,engine!,offline!]);
 for(const image of inspected){assert.equal(image.Os,'linux');assert.equal(image.Architecture,architecture);}
 const imageIds=Object.fromEntries(['frontend','backend','agent','installer','engine','offline'].map((name,index)=>[name,inspected[index]!.Id]));
 const root=await realpath(await mkdtemp(join(tmpdir(),'beetle-compose-evidence-')));
 const home=join(root,'home');const instance='qual-'+randomUUID().slice(0,8);const project='beetle-'+instance;const origin=await ownedOrigin();
 const environment={BEETLE_HOME:home,BEETLE_INSTANCE:instance,BEETLE_PORT:new URL(origin).port,
  BEETLE_FRONTEND_IMAGE:frontend!,BEETLE_BACKEND_IMAGE:backend!,BEETLE_AGENT_IMAGE:agent!,BEETLE_INSTALLER_IMAGE:installer!,BEETLE_ENGINE_IMAGE:engine!,BEETLE_EXPORT_IMAGE:offline!,COMPOSE_PARALLEL_LIMIT:'1'};
 const envFile=join(root,'compose.env');await writeFile(envFile,Object.entries(environment).map(([key,value])=>`${key}='${value}'`).join('\n')+'\n',{mode:0o600});
 const override=join(root,'target.json');
 const program="const counts={ready:0,work:0,unexpected:0};require('node:http').createServer((q,r)=>{if(q.url==='/counts'){r.end(JSON.stringify(counts));return;}const key=q.url==='/ready'?'ready':q.url==='/work'?'work':'unexpected';if(++counts[key]>4)process.exit(3);r.writeHead(key==='unexpected'?404:200);r.end('ok');}).listen(8080,'0.0.0.0');";
 await writeFile(override,JSON.stringify({services:{'synthetic-target':{image:agent,user:'1000:1000',read_only:true,cap_drop:['ALL'],security_opt:['no-new-privileges:true'],
  cpus:0.25,mem_limit:'64m',pids_limit:32,entrypoint:['node','-e',program],networks:{targets:{aliases:['target']}}}}}),{mode:0o600});
 const args=['compose','--project-name',project,'--env-file',envFile,'--file',resolve('docker-compose.yml'),'--file',override];
 const {compose,logs}=composeProcesses(context,args,root);
 const ids=()=>docker.run(['ps','-aq','--no-trunc','--filter',`label=com.docker.compose.project=${project}`]).split('\n').filter(Boolean);
 return {root,home,instance,project,origin,docker,compose,ids,logs,architecture,imageIds,daemonVersion:info.ServerVersion,agent:`beetle-${instance}-agent`,images:{frontend,backend,agent,installer,engine,offline}};
}
export type Fixture=Awaited<ReturnType<typeof fixture>>;
