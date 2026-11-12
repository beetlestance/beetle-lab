/** Explicit local source-image qualification; creates only task-labelled resources. */
import assert from 'node:assert/strict';
import {constants,openSync,readSync,fstatSync,closeSync} from 'node:fs';
import {mkdtemp,writeFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,isAbsolute} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {Docker} from '../../../agent/test/container/docker.js';
import type {Image,Daemon} from '../../../agent/test/container/docker.js';
interface Asset {path:string;type:string;bytes:number;sha256:string}
function manifest(path:string):Asset[]{
 assert(isAbsolute(path));const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=fstatSync(fd);assert(stat.isFile()&&stat.uid===process.getuid!()&&(stat.mode&0o077)===0&&stat.size>0&&stat.size<=65536);
  const bytes=Buffer.alloc(stat.size+1);let used=0;let complete=false;
  for(let n=0;n<32;n++){const count=readSync(fd,bytes,used,bytes.length-used,used);used+=count;assert(used<=stat.size);if(count===0){complete=true;break;}}
  assert(complete);const value=JSON.parse(bytes.subarray(0,used).toString('utf8')) as {assets:Asset[]};
  return checkedAssets(value.assets);
 }finally{closeSync(fd);}
}
function checkedAssets(value:Asset[]):Asset[]{
 assert(Array.isArray(value)&&value.length>=1&&value.length<=8);const seen=new Set<string>();let total=0;
 for(const asset of value){assetValue(asset);assert(!seen.has(asset.path));seen.add(asset.path);total+=asset.bytes;}
 assert(total<=3145728);return value;
}
function assetValue(asset:Asset):void{
 assert(typeof asset.path==='string'&&/^\/reference\/[A-Za-z0-9/.-]{1,100}$/.test(asset.path)&&!asset.path.split('/').includes('..'));
 assert(['text/plain; charset=utf-8','application/json; charset=utf-8'].includes(asset.type));assert(Number.isSafeInteger(asset.bytes)&&asset.bytes>0&&asset.bytes<=2097152);assert(/^[a-f0-9]{64}$/.test(asset.sha256));
}
async function body(response:Response,maximum:number):Promise<Buffer>{
 assert(response.body);const reader=response.body.getReader();const chunks:Buffer[]=[];let bytes=0;
 try{for(let n=0;n<4096;n++){const part=await reader.read();if(part.done)return Buffer.concat(chunks,bytes);bytes+=part.value.byteLength;assert(bytes<=maximum);chunks.push(Buffer.from(part.value));}
  throw Error('Reference response fragment bound');
 }finally{await reader.cancel();}
}
async function ready(origin:string):Promise<void>{
 const deadline=performance.now()+10000;
 for(let n=0;n<30&&performance.now()<deadline;n++){
  try{const response=await fetch(origin+'/healthz',{signal:AbortSignal.timeout(1000),redirect:'error'});await response.body?.cancel();if(response.status===204)return;}catch{/* Startup listener may not yet be accepting the bounded health read. */}
  await new Promise(resolve=>setTimeout(resolve,100));
 }throw Error('Frontend readiness deadline');
}
function media(value:string|null):string{return (value??'').toLowerCase().split(';').map(part=>part.trim()).join(';');}
async function verify(origin:string,assets:Asset[]){
 const verified=[];
 for(const asset of assets){
  const response=await fetch(origin+asset.path,{signal:AbortSignal.timeout(3000),redirect:'error'});assert.equal(response.status,200);
  assert.equal(media(response.headers.get('content-type')),media(asset.type));assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  const bytes=await body(response,asset.bytes);assert.equal(bytes.length,asset.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);
  const head=await fetch(origin+asset.path,{method:'HEAD',signal:AbortSignal.timeout(3000),redirect:'error'});assert.equal(head.status,200);assert.equal(head.body,null);assert.equal(Number(head.headers.get('content-length')),asset.bytes);
  verified.push({path:asset.path,bytes:bytes.length,sha256:asset.sha256,type:response.headers.get('content-type')});
 }
 const missing=await fetch(origin+'/reference/missing.json',{signal:AbortSignal.timeout(3000),redirect:'error'});assert.equal(missing.status,404);await missing.body?.cancel();
 const denied=await fetch(origin+assets[0]!.path,{method:'POST',body:'synthetic',signal:AbortSignal.timeout(3000),redirect:'error'});assert.equal(denied.status,405);await denied.body?.cancel();
 return verified;
}
function logs(context:string,id:string):string{
 const environment:NodeJS.ProcessEnv={...process.env,DOCKER_API_VERSION:'1.47'};delete environment.DOCKER_HOST;delete environment.DOCKER_CONTEXT;
 const result=spawnSync('docker',['--context',context,'logs','--tail','30',id],{env:environment,encoding:'utf8',timeout:10000,maxBuffer:262144});
 assert.equal(result.error,undefined);assert.equal(result.status,0);return result.stdout+result.stderr;
}
const [image,path,context='default']=process.argv.slice(2);assert(image&&path&&process.argv.length<=5);
assert(/^[a-zA-Z0-9][a-zA-Z0-9_./:@-]{0,255}$/.test(image));assert(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(context));
let assets:Asset[];try{assets=manifest(path);}catch{process.stderr.write('Invalid reference qualification manifest\n');process.exit(2);}
const docker=new Docker(context);const daemon=docker.json<Daemon>(['info','--format','{{json .}}']);assert.equal(daemon.OSType,'linux');
const installed=docker.json<Image[]>(['image','inspect',image])[0]!;assert.equal(installed.Os,'linux');
const architecture=daemon.Architecture==='aarch64'?'arm64':daemon.Architecture==='x86_64'?'amd64':daemon.Architecture;assert.equal(installed.Architecture,architecture);
const installation=randomUUID();const name='beetle-reference-'+installation;const root=await realpath(await mkdtemp(join(tmpdir(),'beetle-reference-native-')));
const evidence:Record<string,unknown>={status:'running',cleanupVerified:false,image:installed.Id,architecture:installed.Architecture,daemonVersion:daemon.ServerVersion,
 limits:['Frontend source image/static HTTP only','No actual browser, backend session, k6 workload or release matrix']};let container:string|undefined;
console.log(JSON.stringify({state:'started',root}));
try{
 docker.run(['network','create','--label',`dev.beetle.qualification=${installation}`,name]);
 container=docker.run(['run','-d','--pull=never','--name',name,'--label',`dev.beetle.qualification=${installation}`,'--network',name,
  '--publish','127.0.0.1::8080','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=16777216',
  '--cpus','0.25','--memory','64m','--pids-limit','32',installed.Id]);assert(/^[a-f0-9]{64}$/.test(container));
 const inspect=docker.json<{Config:{User:string};NetworkSettings:{Ports:Record<string,{HostIp:string;HostPort:string}[]>};HostConfig:{ReadonlyRootfs:boolean;Memory:number;NanoCpus:number;PidsLimit:number}}[]>(['inspect',container])[0]!;
 assert.equal(inspect.Config.User,'101:101');assert.equal(inspect.HostConfig.ReadonlyRootfs,true);assert.equal(inspect.HostConfig.Memory,67108864);assert.equal(inspect.HostConfig.NanoCpus,250000000);assert.equal(inspect.HostConfig.PidsLimit,32);
 const binding=inspect.NetworkSettings.Ports['8080/tcp'];assert.equal(binding?.length,1);assert.equal(binding![0]!.HostIp,'127.0.0.1');const port=Number(binding![0]!.HostPort);assert(Number.isSafeInteger(port)&&port>1024&&port<=65535);
 const origin=`http://127.0.0.1:${port}`;await ready(origin);evidence.assets=await verify(origin,assets);evidence.status='passed';
}catch(error){evidence.status='failed';evidence.failure=error instanceof Error?error.message.slice(0,1024):'Unknown qualification failure';evidence.stack=error instanceof Error?error.stack?.slice(0,8192):undefined;process.exitCode=1;}
finally{
 if(container){try{await writeFile(join(root,'container.log'),logs(context,container),{mode:0o600});}catch{evidence.logFailure=true;}}
 try{docker.cleanup(installation);evidence.cleanupVerified=true;}catch{evidence.cleanupVerified=false;evidence.status='failed';process.exitCode=1;}
 await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2),{mode:0o600});console.log(JSON.stringify({status:evidence.status,root,failure:evidence.failure,cleanupVerified:evidence.cleanupVerified}));
}
