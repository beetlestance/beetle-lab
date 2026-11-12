import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from '../../../../agent/test/container/fixture.js';
import { Docker } from '../../../../agent/test/container/docker.js';
import { agentOrigin } from '../configuration.js';
import { provision,captureLogs,targetCounts } from '../containers.js';
import { createStandaloneExportAssignment,deriveInstalledIdentity,validate,captureStandaloneExportResult } from '@beetle/contracts';
import { verifySourceEnvelope,verifySourceChunk } from '@beetle/contracts/output-source';
import type { AttemptSnapshot,Capabilities } from '@beetle/contracts';
interface ExportInspection {State:{Running:boolean;ExitCode:number;OOMKilled:boolean};HostConfig:{NetworkMode:string};Config:{Env:string[];Labels:Record<string,string>}}
import { argumentsFor } from '../configuration.js';
const [agentTag,engineTag,context='default']=process.argv.slice(2);
argumentsFor([agentTag ?? '',engineTag ?? '','200',context]);
assert(agentTag&&engineTag&&process.argv.length<=5);const docker=new Docker(context,2);
const f=await fixture(docker,agentTag,engineTag,200);const digest=(s:string|Uint8Array)=>createHash('sha256').update(s).digest('hex');
const old=f.offer.installedIdentity;f.manifest.schemas.result='https://beetle-lab.dev/contracts/runner/v1/export-result';
f.manifest.capabilities=['standalone-export-v1'];f.manifest.network={required:false,profile:'none'};
f.manifest.entrypoint={executable:'node',arguments:['/beetle/bootstrap/export-main.js']};
for(const p of f.manifest.phases){p.timeoutMs=p.phase==='prepare'?20000:5000;p.outputBytes=4*1048576;}
const {liveMetricMailbox:unused,...profile}=f.profile;void unused;
f.profile={...profile,entrypoint:f.manifest.entrypoint,network:{profile:'none',name:'none'}};
f.offer.requiredCapabilities=['standalone-export-v1'];f.offer.secretReferences=[];f.offer.config.secrets=[];
f.offer.installedIdentity=deriveInstalledIdentity({manifest:f.manifest,profile:f.profile,identity:{manifestId:old.manifestId,profileId:old.profileId,catalogVersion:old.catalogVersion,schemaDigest:old.schemaDigest}},digest);
const make=(offer=f.offer,scriptTimeoutMs=180000)=>createStandaloneExportAssignment({version:1,purpose:'standalone_export',exportId:randomUUID(),requestId:randomUUID(),
 source:{revisionId:randomUUID(),revisionDigest:'c'.repeat(64)},offer,options:{scriptTimeoutMs,maximumBuildBytes:4*1048576}},digest);
const assignment=make();const base='/runner/v1/attempts/'+f.offer.attemptId;
const evidence:Record<string,unknown>={status:'running',phase:'provision',architecture:f.architecture,agentImage:f.agentImage.Id,engineImage:f.engineImage.Id,cleanupVerified:false};
await writeFile(join(f.root,'qualification.json'),JSON.stringify(evidence),{mode:0o600});
console.log(JSON.stringify({state:'started',root:f.root,installation:f.id}));
let origin='';let authority='';const token=(await readFile(f.tokenPath,'utf8')).trim();
const common={'content-type':'application/json',authorization:'Bearer '+token,'x-beetle-organization-id':f.offer.organizationId,'x-beetle-workspace-id':f.offer.workspaceId,'x-beetle-generation':'1'};
async function reply(response:Response){
 assert(response.body);const reader=response.body.getReader();const chunks:Uint8Array[]=[];let bytes=0;
 for(let calls=0;calls<256;calls++){const part=await reader.read();if(part.done)return{status:response.status,body:JSON.parse(Buffer.concat(chunks,bytes).toString('utf8')) as unknown};
  bytes+=part.value.byteLength;if(bytes>1048576){await reader.cancel();throw new Error('reply limit');}chunks.push(part.value);}
 await reader.cancel();throw new Error('reply fragments');
}
async function api(method:string,path:string,body?:unknown,extra:Record<string,string>={}){
 return reply(await fetch(origin+path,{method,headers:{...common,...(authority?{'x-beetle-journal-authority':authority}:{}),...extra},
 ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(3000)}));
}
const pause=()=>new Promise(r=>setTimeout(r,250));
async function ready(){const end=performance.now()+20000;for(let n=0;n<60&&performance.now()<end;n++){
 try{const r=await api('GET','/runner/v1/capabilities');if(r.status===200){assert(validate('Capabilities',r.body).ok);return r.body as Capabilities;}}catch{ /* Bounded startup poll; native process state is checked below. */ }
 const state=docker.json<{State:{Running:boolean}}[]>(['inspect',f.agent])[0]!;assert(state.State.Running,'agent terminated during startup');await pause();}throw new Error('agent startup deadline');}
async function droppedAdmission(){
 const server=createServer(async(q,r)=>{try{
  assert(q.method==='PUT'&&q.url==='/one');let bytes=0;const chunks:Buffer[]=[];let calls=0;
  for await(const chunk of q){assert(++calls<=32);const b=Buffer.from(chunk);bytes+=b.length;assert(bytes<=32768);chunks.push(b);}
  assert.equal(digest(Buffer.concat(chunks,bytes)),digest(JSON.stringify(assignment)));
  const upstream=await api('PUT',base+'/export',assignment);assert.equal(upstream.status,202);evidence.lostReplyAfterAccepted=true;r.destroy();
 }catch{r.destroy();}});server.maxConnections=1;server.headersTimeout=3000;server.requestTimeout=5000;
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert(address&&typeof address==='object');
 try{await assert.rejects(fetch('http://127.0.0.1:'+address.port+'/one',{method:'PUT',body:JSON.stringify(assignment),signal:AbortSignal.timeout(5000)}));assert.equal(evidence.lostReplyAfterAccepted,true);}
 finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
}
let failure:unknown;let cleanupFailure:unknown;
try{
 origin=await provision(f);authority=(await ready()).journalAuthority;
 evidence.phase='old-intake-refusal';assert.equal((await api('PUT',base,assignment)).status,400);assert.equal((await api('GET',base)).status,404);
 evidence.phase='lost-reply';await droppedAdmission();assert.equal((await api('PUT',base+'/export',assignment)).status,202);
 evidence.phase='generation';let snapshot:AttemptSnapshot|undefined;const end=performance.now()+45000;
 for(let n=0;n<140&&performance.now()<end;n++){const r=await api('GET',base);assert.equal(r.status,200);const checked=validate('AttemptSnapshot',r.body);assert(checked.ok);snapshot=checked.value;
  if(snapshot.admission?.state==='released')break;await pause();}
 assert(snapshot?.admission?.state==='released');assert(snapshot.exportResult);assert.equal(snapshot.exportResult.status,'succeeded');assert.equal(snapshot.result,undefined);
 captureStandaloneExportResult(snapshot.exportResult,assignment,digest);
 const inspected=docker.json<ExportInspection[]>(['inspect',f.engine])[0];assert(inspected);assert.equal(inspected.State.Running,false);assert.equal(inspected.State.ExitCode,0);assert.equal(inspected.State.OOMKilled,false);
 assert.equal(inspected.HostConfig.NetworkMode,'none');assert(inspected.Config.Env.includes('BEETLE_JOB_PURPOSE=standalone_export'));assert(inspected.Config.Env.includes('BEETLE_ASSIGNMENT_DIGEST='+assignment.assignmentDigest));
 evidence.physicalStop={state:'exited',exitCode:0,oomKilled:false,network:'none'};
 const sourceReply=await api('GET',base+'/source');assert.equal(sourceReply.status,200);const source=verifySourceEnvelope(sourceReply.body,digest);
 captureStandaloneExportResult(source.manifest.result,assignment,digest);assert('purpose' in source.manifest.result);const artifact=source.manifest.result.artifact;assert(artifact);
 assert.equal(source.manifest.binding.specDigest,inspected.Config.Labels['dev.beetle.spec']);
 const parts:Buffer[]=[];let position=0;for(let calls=0;position<artifact.bytes&&calls<65;calls++){
  const ask={version:1 as const,manifestDigest:source.manifest.manifestDigest,sourceDigest:source.sourceDigest,artifactId:artifact.artifactId,offset:position,length:Math.min(65536,artifact.bytes-position)};
  const r=await api('POST',base+'/source/chunk',ask);assert.equal(r.status,200);const piece=verifySourceChunk(r.body,ask,artifact.bytes);assert(piece.nextOffset>position);parts.push(Buffer.from(piece.base64,'base64'));position=piece.nextOffset;
 }assert.equal(position,artifact.bytes);const script=Buffer.concat(parts,artifact.bytes);assert.equal(digest(script),artifact.sha256);
 assert.equal((await api('GET',base+'/source',undefined,{'x-beetle-organization-id':randomUUID()})).status,404);
 const changed={...assignment};Reflect.deleteProperty(changed,'assignmentDigest');
 const altered=createStandaloneExportAssignment({...changed,options:{...assignment.options,scriptTimeoutMs:180001}},digest);
 assert.equal((await api('PUT',base+'/export',altered)).status,409);
 evidence.phase='restart';docker.run(['restart','--time','10',f.agent]);origin=agentOrigin(docker.run(['port',f.agent,'4312/tcp']));assert.equal((await ready()).journalAuthority,authority);
 const reopened=await api('GET',base+'/source');assert.equal(reopened.status,200);assert.deepEqual(verifySourceEnvelope(reopened.body,digest),source);
 assert.equal((await api('PUT',base+'/export',assignment)).status,202);
 const cancelled=make({...f.offer,attemptId:randomUUID(),intentDigest:digest('cancel-'+f.id)});const cancelledPath='/runner/v1/attempts/'+cancelled.offer.attemptId;
 assert.equal((await api('POST',cancelledPath+'/export/cancel-original',cancelled)).status,200);
 const late=await api('PUT',cancelledPath+'/export',cancelled);assert.equal(late.status,202);
 const refused=validate('AttemptSnapshot',late.body);assert(refused.ok);assert.equal(refused.value.cancelRequested,true);assert.equal(refused.value.admission?.state,'rejected');assert.equal(refused.value.admission?.reason,'cancelled');
 const engineIds=docker.run(['ps','-aq','--no-trunc','--filter',`label=dev.beetle.installation=${f.id}`]).split('\n').filter(Boolean);assert.equal(engineIds.length,1);
 evidence.engineExecutions=engineIds.length;evidence.targetCounts=targetCounts(f,{ready:0,work:0,unexpected:0});
 evidence.assignmentDigest=assignment.assignmentDigest;evidence.sourceDigest=source.sourceDigest;evidence.scriptBytes=artifact.bytes;evidence.scriptSha256=artifact.sha256;evidence.reopenSameSource=true;
 evidence.status='passed';evidence.phase='cleanup';
}catch(error){failure=error;evidence.status='failed';evidence.failure=error instanceof Error?error.name:'unknown';}
finally{
 evidence.logFailures=await captureLogs(f);try{docker.cleanup(f.id);evidence.cleanupVerified=true;}catch(error){cleanupFailure=error;evidence.cleanupVerified=false;}
 await writeFile(join(f.root,'qualification.json'),JSON.stringify(evidence,null,2),{mode:0o600});console.log(JSON.stringify(evidence));
}

if(failure)throw failure;if(cleanupFailure)throw cleanupFailure;
