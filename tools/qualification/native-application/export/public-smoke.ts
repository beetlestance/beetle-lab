/** Explicit host-backend/public HTTP -> installed agent -> offline Docker proof. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {exportContentPath} from '@beetle/contracts/api';
import type {ExportJob} from '@beetle/contracts/api';
import {openApplication} from '../../../../app/src/bootstrap/api.js';
import type {Application} from '../../../../app/src/bootstrap/api.js';
import {fixture,digest} from '../../../../agent/test/container/fixture.js';
import {Docker} from '../../../../agent/test/container/docker.js';
import type {Image} from '../../../../agent/test/container/docker.js';
import {runtimeName} from '../../../../agent/src/backends/docker/index.js';
import {captureStandaloneExportAssignment} from '@beetle/contracts';
import {verifySourceEnvelope} from '@beetle/contracts/output-source';
import {argumentsFor,agentOrigin} from '../configuration.js';
import {provision,captureLogs,targetCounts} from '../containers.js';
import {ownedOrigin,publicClient,waitForCapacity,saveRevision,value,pause} from '../public-api.js';
import {offlineProfile,addOfflineEngine,exportBackendConfiguration} from './public-configuration.js';
const [agentTag,performanceTag,exportTag,context='default']=process.argv.slice(2);
argumentsFor([agentTag??'',performanceTag??'','200',context]);assert(exportTag&&/^[a-zA-Z0-9][a-zA-Z0-9_./:@-]{0,255}$/.test(exportTag)&&process.argv.length<=6);
const docker=new Docker(context,2);const f=await fixture(docker,agentTag!,performanceTag!,200);
const image=docker.json<Image[]>(['image','inspect',exportTag])[0]!;assert.equal(image.Os,'linux');assert.equal(image.Architecture,f.architecture);
const offline=offlineProfile(f,image);let app:Application|undefined;
const evidence:Record<string,unknown>={status:'running',phase:'provision',architecture:f.architecture,agentImage:f.agentImage.Id,ordinaryImage:f.engineImage.Id,
 exportImage:image.Id,cleanupVerified:false,limitations:['Host backend and supplied frozen private engine/agent images; no shipped backend image, browser, Compose or release qualification.','No in-flight crash or delayed-daemon absence claim.']};
console.log(JSON.stringify({state:'started',root:f.root,installation:f.id}));
async function finished(session:Awaited<ReturnType<typeof publicClient>>,params:{organizationId:string;workspaceId:string;exportId:string}):Promise<ExportJob>{
 for(let calls=0;calls<160;calls++){
  const job=value(await session.api.getExport({params}));if(['ready','failed','cancelled'].includes(job.state)){assert.equal(job.state,'ready',job.reason??job.state);return job;}await pause();
 }throw Error('Public export did not settle');
}
async function script(response:Response,maximum:number):Promise<Buffer>{
 assert.equal(response.status,200);assert(response.body);assert.match(response.headers.get('content-disposition')??'',/\.js"$/);
 const chunks:Buffer[]=[];let bytes=0;const reader=response.body.getReader();
 for(let calls=0;calls<256;calls++){const part=await reader.read();if(part.done)return Buffer.concat(chunks,bytes);
  bytes+=part.value.length;if(bytes>maximum){await reader.cancel();throw Error('Script exceeded bound');}chunks.push(Buffer.from(part.value));}
 await reader.cancel();throw Error('Script fragment bound');
}
function closed(job:ExportJob){
 const db=new DatabaseSync(join(f.root,'backend','metadata.sqlite'),{readOnly:true});
 try{
  const rows=db.prepare(`SELECT j.execution_charged,j.output_charged,j.journal_authority,o.assignment_json,s.source_json FROM export_jobs j
   JOIN export_originals o ON o.export_id=j.id JOIN export_sources s ON s.export_id=j.id WHERE j.id=? LIMIT 2`).all(job.id);assert.equal(rows.length,1);const row=rows[0]!;
  assert.equal(row.execution_charged,0);assert.equal(row.output_charged,job.artifact!.bytes);assert.equal(typeof row.assignment_json,'string');assert.equal(typeof row.source_json,'string');
  const assignment=captureStandaloneExportAssignment(JSON.parse(row.assignment_json as string),digest);const source=verifySourceEnvelope(JSON.parse(row.source_json as string),digest);
  assert.equal(assignment.exportId,job.id);assert.equal(assignment.offer.attemptId,job.activeAttemptId);assert.equal(source.manifest.binding.journalAuthority,row.journal_authority);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM runs').get()?.n,0);
  assert.equal(db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes,3145728+job.artifact!.bytes);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);return {assignment,source};
 }finally{db.close();}
}
try{
 const agent=await provision(f,4,path=>addOfflineEngine(path,offline));const origin=await ownedOrigin();const config=await exportBackendConfiguration(f,agent,origin,offline.pin);
 evidence.metadataWorkerDigest=digest(await readFile(config.application.metadata.workerUrl));
 evidence.phase='public-startup';app=await openApplication(config.application);await app.server.listen({...config.listen});await waitForCapacity(app);
 let session=await publicClient(app,origin);f.offer.config.secrets=[];const saved=await saveRevision(session.api,f);
 assert.deepEqual(value(await session.api.getExportProfiles({params:saved.params})).profiles,['native-k6']);
 const body={scope:saved.scope,requestId:randomUUID(),revisionId:saved.revision.id,engineProfile:'native-k6',budget:f.budget,
  executionPolicy:{mode:'parallel' as const,preferIdle:false},options:{scriptTimeoutMs:180000,maximumBuildBytes:4*1048576}};
 const params={...saved.params,revisionId:saved.revision.id};evidence.phase='public-enqueue';
 const queued=value(await session.api.createExport({params,body}));assert.deepEqual(value(await session.api.createExport({params,body})),queued);
 const selected={...saved.params,exportId:queued.id};const job=await finished(session,selected);assert(job.artifact);
 const content=exportContentPath(selected);const bytes=await script(await session.content(content),body.options.maximumBuildBytes);
 assert.equal(bytes.length,job.artifact.bytes);assert.equal(digest(bytes),job.artifact.sha256);
 assert.equal((await session.content(content.replace(selected.workspaceId,randomUUID()))).status,404);
 await app.close();app=undefined;const physical=closed(job);const name=runtimeName({installationId:f.id,...physical.assignment.offer,generation:1});
 const native=docker.json<{State:{Running:boolean;ExitCode:number;OOMKilled:boolean};HostConfig:{NetworkMode:string};Image:string}[]>(['inspect',name])[0]!;
 assert.equal(native.Image,image.Id);assert.deepEqual(native.State.Running,false);assert.equal(native.State.ExitCode,0);assert.equal(native.State.OOMKilled,false);assert.equal(native.HostConfig.NetworkMode,'none');
 evidence.publicReady={scriptBytes:bytes.length,scriptSha256:job.artifact.sha256,physicalStop:{exitCode:0,oomKilled:false,network:'none'}};
 evidence.phase='restart';docker.run(['restart','--time','10',f.agent]);
 const runtime=config.application.agent;const afterRestart={...config.application,agent:{...runtime,connection:{...runtime.connection,
  configuration:{...runtime.connection.configuration,origin:agentOrigin(docker.run(['port',f.agent,'4312/tcp']))}}}};
 app=await openApplication(afterRestart);await app.server.listen({...config.listen});await waitForCapacity(app);session=await publicClient(app,origin);
 assert.deepEqual(value(await session.api.getExport({params:selected})),job);assert.deepEqual(await script(await session.content(content),body.options.maximumBuildBytes),bytes);
 assert.deepEqual(value(await session.api.createExport({params,body})),queued);await app.close();app=undefined;assert.deepEqual(closed(job),physical);
 const engines=docker.run(['ps','-aq','--no-trunc','--filter',`label=dev.beetle.installation=${f.id}`]).split('\n').filter(Boolean);assert.equal(engines.length,1);
 Object.assign(evidence,{status:'passed',phase:'cleanup',engineExecutions:1,scriptBytes:bytes.length,scriptSha256:job.artifact.sha256,
  assignmentDigest:physical.assignment.assignmentDigest,sourceDigest:physical.source.sourceDigest,reopenSamePublicScript:true,
  physicalStop:{exitCode:0,oomKilled:false,network:'none'},targetCounts:targetCounts(f,{ready:0,work:0,unexpected:0})});
}catch(error){evidence.status='failed';evidence.stack=error instanceof Error?error.stack?.slice(0,8192):undefined;evidence.failure=error instanceof Error?`${error.name}: ${error.message}`.slice(0,1024):'Unknown qualification failure';process.exitCode=1;}
finally{
 try{await app?.close();}catch{evidence.status='failed';evidence.applicationCloseFailure=true;process.exitCode=1;}
 evidence.logFailures=await captureLogs(f);try{docker.cleanup(f.id);evidence.cleanupVerified=true;}catch{evidence.status='failed';evidence.cleanupVerified=false;process.exitCode=1;}
 await writeFile(join(f.root,'public-export-evidence.json'),JSON.stringify(evidence,null,2),{mode:0o600});console.log(JSON.stringify({status:evidence.status,root:f.root,failure:evidence.failure,cleanupVerified:evidence.cleanupVerified}));
}
