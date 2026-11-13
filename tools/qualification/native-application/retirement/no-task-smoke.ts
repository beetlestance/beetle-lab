/** Manual actual no-task cleanup/recovery qualification; no production startup behavior is changed. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile,readdir,lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { Docker } from '../../../../agent/test/container/docker.js';
import { fixture,digest } from '../../../../agent/test/container/fixture.js';
import type { Offer } from '@beetle/contracts';
import { assertNoTaskFunding } from './no-task-funding.js';
import type { Run } from '@beetle/contracts/api';
import { runtimeName } from '../../../../agent/src/backends/docker/index.js';
import { namespaceCaps } from '../../../../agent/src/staging-namespace/index.js';
import { openApplication } from '../../../../app/src/bootstrap/api.js';
import type { Application } from '../../../../app/src/bootstrap/api.js';
import { openMetadata } from '../../../../app/src/adapters/outbound/sqlite/index.js';
import type { Metadata } from '../../../../app/src/adapters/outbound/sqlite/index.js';
import { openAgentRuntime } from '../../../../app/src/bootstrap/agent-runtime.js';
import { createRunnerGateway } from '../../../../app/src/adapters/outbound/runner/index.js';
import { prepareOutputDeletion } from '../../../../app/src/application/output-deletion/index.js';
import { cleanedReplyDigest } from '@beetle/contracts/output-settlement';
import { argumentsFor,backendConfiguration } from '../configuration.js';
import { provision,targetCounts,captureLogs } from '../containers.js';
import { enqueue,ownedOrigin,publicClient,waitForCapacity,value,pause } from '../public-api.js';
import { cleanupLiveVolumes } from '../live-volumes.js';
import { driverOptions,lostDriverReply } from './driver.js';
import { bounded,record,exactError } from './metadata.js';
import { retirementProxy } from './proxy.js';
import { offerPauseProxy } from './offer-pause-proxy.js';
import { seedAdmittedNoTask } from './no-task-state.js';
import { settledAgent,settledBackend } from './settlement-storage.js';
import { currentOrigin,waitFor } from './docker-sidecar.js';
const[mode,...rest]=process.argv.slice(2);assert(mode==='rejected'||mode==='admitted');const args=argumentsFor(rest);
const f=await fixture(new Docker(args.context,2),args.agentImage,args.engineImage,args.status);
const evidence:Record<string,unknown>={status:'running',phase:'provision',mode,cleanupVerified:false,architecture:f.architecture,backendPlatform:process.platform,nodeVersion:process.version,
 agentImage:f.agentImage.Id,engineImage:f.engineImage.Id,limits:['Qualification overlay; not production recipe, amd64 or full Linux backend release evidence.',
 'Offer delivery intentionally paused; admitted mode seeds the exact original through actual Linux guards/catalogue/policy before abort. No production HTTP admission claim.']};
let app:Application|undefined;let metadata:Metadata|undefined;let runtime:Awaited<ReturnType<typeof openAgentRuntime>>|undefined;
let gateway:ReturnType<typeof createRunnerGateway>|undefined;let proxy:Awaited<ReturnType<typeof retirementProxy>>|undefined;let capture:Awaited<ReturnType<typeof offerPauseProxy>>|undefined;
const started=Date.now();console.log(JSON.stringify({state:'started',mode,root:f.root}));
try{
 const origin=await provision(f);capture=await offerPauseProxy(origin);const external=await ownedOrigin();
 const configuration=await backendConfiguration(f,capture.origin,external);assert(configuration.application.agent);
 evidence.phase='capture-original';app=await openApplication(configuration.application);await app.server.listen({...configuration.listen});
 const session=await publicClient(app,external);await waitForCapacity(app);const queued=await enqueue(session.api,f);
 const canonical=await bounded(capture.first,'No actual original reached capture',30000);f.offer=JSON.parse(canonical) as Offer;f.engine=runtimeName({installationId:f.id,...f.offer,generation:1});
 assert.equal(f.offer.organizationId,queued.scope.organizationId);assert.equal(f.offer.workspaceId,queued.scope.workspaceId);assert.equal(f.offer.attemptId,value(await session.api.getRun({params:{organizationId:queued.scope.organizationId,workspaceId:queued.scope.workspaceId,runId:queued.id}})).activeAttemptId);
 value(await session.api.cancelRun({params:{organizationId:queued.scope.organizationId,workspaceId:queued.scope.workspaceId,runId:queued.id},body:{scope:queued.scope,requestId:randomUUID()}}));
 await app.close();app=undefined;await capture.close();evidence.capture=capture.state();assert.equal(capture.state().failures,0);capture=undefined;
 evidence.phase='no-task-setup';if(mode==='admitted')evidence.seed=await seedAdmittedNoTask(f,canonical);
 const resumed={...configuration.application.agent,connection:{...configuration.application.agent.connection,configuration:{...configuration.application.agent.connection.configuration,origin:currentOrigin(f)}}};
 app=await openApplication({...configuration.application,agent:resumed});await app.server.listen({...configuration.listen});const resumedSession=await publicClient(app,external);
 let terminal:Run|undefined;const params={organizationId:queued.scope.organizationId,workspaceId:queued.scope.workspaceId,runId:queued.id};
 for(let turn=0;turn<240;turn++){
  const run=value(await resumedSession.api.getRun({params}));if(['finished','cancelled','errored'].includes(run.state)){assert.equal(value(await resumedSession.api.getRunResult({params})).result,null);terminal=run;break;}await pause();
 }
 assert(terminal,'No-task finalization did not converge');await app.close();app=undefined;
 assert.equal(terminal.state,'cancelled');assert.equal(terminal.outcome,'inconclusive');assert.equal(terminal.reason,'cancelled');
 evidence.terminal={state:terminal.state,outcome:terminal.outcome,reason:terminal.reason};
 const options=driverOptions({metadata:configuration.application.metadata,agent:resumed});metadata=await openMetadata(options.metadata);
 const before=(await metadata.inputs.storage()).chargedBytes;const run=await metadata.runs.getRun({scope:terminal.scope,id:queued.id});
 const command=prepareOutputDeletion({kind:'beginOutputDeletion',id:randomUUID(),requestedAt:new Date().toISOString(),request:{scope:run.scope,runId:run.id,requestId:randomUUID(),expectedRunVersion:run.version}},digest);
 const intent=await metadata.outputDeletions.begin(command);assert.equal(intent.kind,'absence');assert.equal(intent.fileCount,0);const key={id:intent.id,runId:intent.runId,scope:intent.scope};
 evidence.phase='lost-agent-settlement-reply';proxy=await retirementProxy(currentOrigin(f),10000,true);
 const proxied={...options.agent,connection:{...options.agent.connection,configuration:{...options.agent.connection.configuration,origin:proxy.origin}}};
 runtime=await openAgentRuntime(proxied,metadata);const observed=await bounded(proxy.settlement,'No-task settlement did not commit',60000);
 await runtime.close();runtime=undefined;assert.equal((await metadata.inputs.storage()).chargedBytes,before);assert.equal((await metadata.outputDeletions.cleanupAck(key)).kind,'stored');
 await metadata.close();metadata=undefined;await proxy.close();evidence.proxy=proxy.state();proxy=undefined;
 f.docker.run(['stop','-t','10',f.agent]);const agentState=settledAgent(f,observed);assertNoTaskFunding(mode,agentState.body,evidence.seed);evidence.agentAfterLostReply=agentState;f.docker.run(['start',f.agent]);
 const restarted={...options.agent,connection:{...options.agent.connection,configuration:{...options.agent.connection.configuration,origin:currentOrigin(f)}}};
 gateway=createRunnerGateway(restarted.connection);await waitFor(async()=>{const value=await gateway!.capabilities();return value.ok;},'No-task agent did not reopen');
 const replay=await gateway.settleOutput(observed.request);assert(replay.ok);assert.deepEqual(replay.value,observed.reply);
 const retirement=await gateway.retireOutput(observed.request.retirement);assert(retirement.ok);assert.equal(cleanedReplyDigest(retirement.value,observed.request.retirement,digest),observed.request.cleanupReplyDigest);await gateway.close();gateway=undefined;
 evidence.phase='lost-backend-settlement-reply';const loss=await lostDriverReply({...options,agent:restarted},value=>{const row=record(value);return row?.version===1&&row.chargedBytes===2560&&record(row.key)?.id===key.id;});
 const committed=loss.value as Awaited<ReturnType<Metadata['outputSettlements']['settle']>>;evidence.backendFailure=loss.failure;
 evidence.backendAfterLostReply=settledBackend(options.metadata.path,run.id,committed.refundedBytes,before);
 metadata=await openMetadata(options.metadata);assert.deepEqual(await metadata.outputSettlements.settle({key,agentReply:observed.reply}),committed);assert.deepEqual(await metadata.outputSettlements.read(key),{kind:'settled',settlement:committed});
 assert.equal((await metadata.inputs.storage()).chargedBytes,2560);await metadata.close();metadata=undefined;
 f.docker.run(['stop','-t','10',f.agent]);assert.deepEqual(settledAgent(f,observed),evidence.agentAfterLostReply);
 await assert.rejects(lstat(join(f.root,'staging',f.engine)),{code:'ENOENT'});assert.deepEqual(await readdir(join(f.root,'staging')),[namespaceCaps.markerName]);
 assert.equal(f.docker.run(['ps','-aq','--filter',`label=dev.beetle.installation=${f.id}`]),'');assert.equal(f.docker.run(['volume','ls','-q','--filter',`label=dev.beetle.installation=${f.id}`]),'');
 Object.assign(evidence,{status:'passed',phase:'finished',runId:run.id,deletionId:key.id,agentReply:observed.reply,backendSettlement:committed,
  originalBackendCharge:before,agentReplayBytes:4096,backendReplayBytes:2560,originalEngineExecutions:0,targetCounts:targetCounts(f,{ready:0,work:0,unexpected:0})});
}catch(error){evidence.status='failed';evidence.failure=error instanceof Error?`${error.name}: ${error.message}`.slice(0,1024):'Unknown failure';evidence.stack=error instanceof Error?error.stack?.slice(0,4096):undefined;process.exitCode=1;}
finally{
 for(const[name,close]of [['application',()=>app?.close()],['runtime',()=>runtime?.close()],['gateway',()=>gateway?.close()],['metadata',()=>metadata?.abort()],['proxy',()=>proxy?.close()],['capture',()=>capture?.close()]] as const){
  try{await close();}catch(error){evidence[`${name}CloseFailure`]=exactError(error);evidence.status='failed';process.exitCode=1;}
 }
 try{evidence.diagnosticFailures=await captureLogs(f);f.docker.cleanup(f.id);evidence.removedMailboxVolumes=cleanupLiveVolumes(f);evidence.cleanupVerified=true;}
 catch(error){evidence.cleanupFailure=exactError(error);evidence.status='failed';process.exitCode=1;}
 evidence.elapsedMs=Date.now()-started;await writeFile(join(f.root,'no-task-evidence.json'),JSON.stringify(evidence,null,2),{mode:0o600});console.log(JSON.stringify({status:evidence.status,mode,root:f.root,failure:evidence.failure,cleanupVerified:evidence.cleanupVerified}));
}
