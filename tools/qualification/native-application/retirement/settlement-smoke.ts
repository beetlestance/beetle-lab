/** Manual native cleanup and exact settlement reply-loss qualification; synthetic installation only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile,readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Docker } from '../../../../agent/test/container/docker.js';
import { fixture,digest } from '../../../../agent/test/container/fixture.js';
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
import { enqueue,finished,ownedOrigin,publicClient,waitForCapacity } from '../public-api.js';
import { inspectClosed } from '../evidence.js';
import { cleanupLiveVolumes } from '../live-volumes.js';
import { driverOptions,lostDriverReply } from './driver.js';
import { bounded,record,exactError } from './metadata.js';
import { retirementProxy } from './proxy.js';
import { settledAgent,settledBackend } from './settlement-storage.js';
import { currentOrigin,waitFor } from './docker-sidecar.js';
type BackendSettlementResult=Awaited<ReturnType<Metadata['outputSettlements']['settle']>>;
const args=argumentsFor(process.argv.slice(2));const f=await fixture(new Docker(args.context,2),args.agentImage,args.engineImage,args.status);
const evidence:Record<string,unknown>={status:'running',phase:'provision',cleanupVerified:false,architecture:f.architecture,backendPlatform:process.platform,nodeVersion:process.version,
 agentImage:f.agentImage.Id,engineImage:f.engineImage.Id,limits:['Qualification overlays; not production recipe, amd64 or full Linux backend release evidence.','Admitted source branch; absence/never-admitted capacity need their own stated evidence.']};
let app:Application|undefined;let metadata:Metadata|undefined;let runtime:Awaited<ReturnType<typeof openAgentRuntime>>|undefined;
let gateway:ReturnType<typeof createRunnerGateway>|undefined;let proxy:Awaited<ReturnType<typeof retirementProxy>>|undefined;
const started=Date.now();console.log(JSON.stringify({state:'started',root:f.root}));
try{
 const origin=await provision(f);const external=await ownedOrigin();const configuration=await backendConfiguration(f,origin,external);assert(configuration.application.agent);
 evidence.phase='public-run';app=await openApplication(configuration.application);await app.server.listen({...configuration.listen});
 const session=await publicClient(app,external);await waitForCapacity(app);const queued=await enqueue(session.api,f);const terminal=await finished(session.api,queued,f.workStatus);
 await app.close();app=undefined;const physical=await inspectClosed(f,terminal.run,terminal.result);f.offer=physical.offer;f.engine=runtimeName({installationId:f.id,...f.offer,generation:1});
 const options=driverOptions({metadata:configuration.application.metadata,agent:configuration.application.agent});metadata=await openMetadata(options.metadata);
 const before=(await metadata.inputs.storage()).chargedBytes;const run=await metadata.runs.getRun({scope:terminal.run.scope,id:queued.id});
 const command=prepareOutputDeletion({kind:'beginOutputDeletion',id:randomUUID(),requestedAt:new Date().toISOString(),request:{scope:run.scope,runId:run.id,requestId:randomUUID(),expectedRunVersion:run.version}},digest);
 const intent=await metadata.outputDeletions.begin(command);const key={id:intent.id,runId:intent.runId,scope:intent.scope};assert(intent.fileCount>0);
 evidence.phase='lost-agent-settlement-reply';proxy=await retirementProxy(origin,10000,true);
 const proxied={...options.agent,connection:{...options.agent.connection,configuration:{...options.agent.connection.configuration,origin:proxy.origin}}};
 runtime=await openAgentRuntime(proxied,metadata);const observed=await bounded(proxy.settlement,'Agent settlement did not commit',60000);
 await runtime.close();runtime=undefined;assert.equal((await metadata.inputs.storage()).chargedBytes,before);
 assert.equal((await metadata.outputDeletions.cleanupAck(key)).kind,'stored');await metadata.close();metadata=undefined;
 await proxy.close();evidence.proxy=proxy.state();proxy=undefined;
 f.docker.run(['stop','-t','10',f.agent]);assert.equal(f.docker.json<{State:{ExitCode:number}}[]>(['inspect',f.agent])[0]!.State.ExitCode,0);
 evidence.agentAfterLostReply=settledAgent(f,observed);f.docker.run(['start',f.agent]);
 const restarted={...options.agent,connection:{...options.agent.connection,configuration:{...options.agent.connection.configuration,origin:currentOrigin(f)}}};
 gateway=createRunnerGateway(restarted.connection);await waitFor(async()=>{const reply=await gateway!.capabilities();return reply.ok;},'Agent did not reopen');
 const replay=await gateway.settleOutput(observed.request);assert(replay.ok);assert.deepEqual(replay.value,observed.reply);
 const cleanupReplay=await gateway.retireOutput(observed.request.retirement);assert(cleanupReplay.ok);
 assert.equal(cleanedReplyDigest(cleanupReplay.value,observed.request.retirement,digest),observed.request.cleanupReplyDigest);await gateway.close();gateway=undefined;
 evidence.phase='lost-backend-settlement-reply';const loss=await lostDriverReply({...options,agent:restarted},value=>{
  const row=record(value);return row?.version===1&&row.chargedBytes===2560&&record(row.key)?.id===key.id;
 });const committed=loss.value as BackendSettlementResult;assert.equal(committed.key.id,key.id);evidence.backendFailure=loss.failure;
 evidence.backendAfterLostReply=settledBackend(options.metadata.path,run.id,committed.refundedBytes,before);
 metadata=await openMetadata(options.metadata);assert.deepEqual(await metadata.outputSettlements.settle({key,agentReply:observed.reply}),committed);
 assert.deepEqual(await metadata.outputSettlements.read(key),{kind:'settled',settlement:committed});
 assert.equal((await metadata.inputs.storage()).chargedBytes,2560);assert.deepEqual(await metadata.outputDeletions.scanSettlements({limit:32}),{items:[],nextCursor:null});
 await metadata.close();metadata=undefined;
 f.docker.run(['stop','-t','10',f.agent]);assert.equal(f.docker.json<{State:{ExitCode:number}}[]>(['inspect',f.agent])[0]!.State.ExitCode,0);
 assert.deepEqual(settledAgent(f,observed),evidence.agentAfterLostReply);
 const published=join(options.agent.dataRoot,'outputs','published',run.scope.organizationId,run.scope.workspaceId,run.id,run.activeAttemptId);
 assert.deepEqual(await readdir(published),[]);assert.deepEqual(await readdir(join(f.root,'staging')),[namespaceCaps.markerName]);
 assert.equal(f.docker.run(['ps','-aq','--no-trunc','--filter',`label=dev.beetle.installation=${f.id}`]),'');
 assert.equal(f.docker.run(['volume','ls','-q','--filter',`label=dev.beetle.installation=${f.id}`]),'');
 Object.assign(evidence,{status:'passed',phase:'finished',runId:run.id,deletionId:key.id,agentReply:observed.reply,backendSettlement:committed,
  originalBackendCharge:before,agentReplayBytes:4096,backendReplayBytes:2560,engineExecutions:1,targetCounts:targetCounts(f)});
}catch(error){evidence.status='failed';evidence.failure=error instanceof Error?`${error.name}: ${error.message}`.slice(0,1024):'Unknown failure';evidence.stack=error instanceof Error?error.stack?.slice(0,4096):undefined;process.exitCode=1;}
finally{
 for(const [name,close]of [['application',()=>app?.close()],['runtime',()=>runtime?.close()],['gateway',()=>gateway?.close()],['metadata',()=>metadata?.abort()],['proxy',()=>proxy?.close()]] as const){
  try{await close();}catch(error){evidence[`${name}CloseFailure`]=exactError(error);evidence.status='failed';process.exitCode=1;}
 }
 try{evidence.diagnosticFailures=await captureLogs(f);f.docker.cleanup(f.id);evidence.removedMailboxVolumes=cleanupLiveVolumes(f);evidence.cleanupVerified=true;}
 catch(error){evidence.cleanupFailure=exactError(error);evidence.status='failed';process.exitCode=1;}
 evidence.elapsedMs=Date.now()-started;await writeFile(join(f.root,'settlement-evidence.json'),JSON.stringify(evidence,null,2),{mode:0o600});
 console.log(JSON.stringify({status:evidence.status,root:f.root,failure:evidence.failure,cleanupVerified:evidence.cleanupVerified}));
}
