/** Manual actual agent crash/unlink recovery. No user installation is selected. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {Docker,request} from '../../../../agent/test/container/docker.js';
import {fixture,digest} from '../../../../agent/test/container/fixture.js';
import {runtimeName} from '../../../../agent/src/backends/docker/index.js';
import {namespaceCaps} from '../../../../agent/src/staging-namespace/index.js';
import {openApplication} from '../../../../app/src/bootstrap/api.js';
import type {Application} from '../../../../app/src/bootstrap/api.js';
import {openMetadata} from '../../../../app/src/adapters/outbound/sqlite/index.js';
import type {Metadata} from '../../../../app/src/adapters/outbound/sqlite/index.js';
import {createRunnerGateway} from '../../../../app/src/adapters/outbound/runner/index.js';
import {prepareOutputDeletion} from '../../../../app/src/application/output-deletion/index.js';
import {argumentsFor,backendConfiguration} from '../configuration.js';
import {provision,targetCounts,captureLogs} from '../containers.js';
import {enqueue,finished,ownedOrigin,publicClient,waitForCapacity} from '../public-api.js';
import {inspectClosed} from '../evidence.js';
import {cleanupLiveVolumes} from '../live-volumes.js';
import {driverOptions,lostDriverReply,ackReply} from './driver.js';
import {bounded,exactError} from './metadata.js';
import {finishBackendFiles} from './backend-files.js';
import {startDockerSidecar,currentOrigin,killAgent,restartAgent,waitFor} from './docker-sidecar.js';
import {installUnlinkFault,inspectAndRemoveUnlinkFault,retainedAgentCounters} from './journal-fault.js';
const args=argumentsFor(process.argv.slice(2));const f=await fixture(new Docker(args.context,2),args.agentImage,args.engineImage,args.status);
const evidence:Record<string,unknown>={status:'running',phase:'provision',cleanupVerified:false,architecture:f.architecture,backendPlatform:process.platform,nodeVersion:process.version,
 agentImage:f.agentImage.Id,engineImage:f.engineImage.Id,limits:['Task-only Docker socket proxy and offline fault trigger; neither is a production recovery mechanism.','Darwin backend/Linux arm64 agent where reported; no production-image or amd64 claim.']};
let app:Application|undefined;let metadata:Metadata|undefined;let gateway:ReturnType<typeof createRunnerGateway>|undefined;let sidecar:Awaited<ReturnType<typeof startDockerSidecar>>|undefined;
const started=Date.now();console.log(JSON.stringify({state:'started',root:f.root}));
async function ready(){await waitFor(async()=>{try{return request(f.docker,{agent:f.agent,credentialFile:f.tokenPath,path:'/runner/v1/capabilities'}).status===200;}catch{return false;}},'Agent did not recover readiness');}
try{
 const origin=await provision(f);const external=await ownedOrigin();const configuration=await backendConfiguration(f,origin,external);assert(configuration.application.agent);
 evidence.phase='public-run';app=await openApplication(configuration.application);await app.server.listen({...configuration.listen});const session=await publicClient(app,external);await waitForCapacity(app);
 const queued=await enqueue(session.api,f);const terminal=await finished(session.api,queued,f.workStatus);await app.close();app=undefined;
 const physical=await inspectClosed(f,terminal.run,terminal.result);f.offer=physical.offer;f.engine=runtimeName({installationId:f.id,...f.offer,generation:1});
 const options=driverOptions({metadata:configuration.application.metadata,agent:configuration.application.agent});metadata=await openMetadata(options.metadata);const before=await metadata.inputs.storage();
 const run=await metadata.runs.getRun({scope:terminal.run.scope,id:queued.id});const command=prepareOutputDeletion({kind:'beginOutputDeletion',id:randomUUID(),requestedAt:new Date().toISOString(),request:{scope:run.scope,runId:run.id,requestId:randomUUID(),expectedRunVersion:run.version}},digest);
 const intent=await metadata.outputDeletions.begin(command);const key={id:intent.id,runId:intent.runId,scope:intent.scope};await metadata.close();metadata=undefined;
 evidence.phase='backend-file-receipts';const retirement=await finishBackendFiles(options,key);
 const original=f.docker.json<{Id:string;State:{Running:boolean}}[]>(['inspect',f.engine])[0]!;assert(/^[a-f0-9]{64}$/.test(original.Id));assert.equal(original.State.Running,false);
 evidence.phase='container-removed-before-mailbox';sidecar=await startDockerSidecar(f,original.Id);await ready();
 let connection={...options.agent.connection,configuration:{...options.agent.connection.configuration,origin:currentOrigin(f)}};gateway=createRunnerGateway(connection);
 const pending=gateway.retireOutput(retirement);await bounded(Promise.race([sidecar.marker(),pending.then(value=>{throw Error(`Retirement ended before crash marker: ${JSON.stringify(value).slice(0,2048)}`);})]),'No crash marker');
 killAgent(f);const interrupted=await pending;assert.equal(interrupted.ok,false);await gateway.close();gateway=undefined;
 assert.equal(f.docker.run(['ps','-aq','--no-trunc','--filter',`label=dev.beetle.installation=${f.id}`]),'');
 assert.equal(f.docker.run(['volume','ls','-q','--filter',`label=dev.beetle.installation=${f.id}`]),`${f.engine}-live`);
 const agentBefore=retainedAgentCounters(f,f.offer.attemptId);evidence.firstCrash=installUnlinkFault(f,f.offer.attemptId);
 metadata=await openMetadata(options.metadata);assert.deepEqual(await metadata.outputDeletions.cleanupAck(key),{kind:'missing'});assert.deepEqual(await metadata.inputs.storage(),before);await metadata.close();metadata=undefined;
 evidence.phase='actual-unlink-before-progress-commit';restartAgent(f);await ready();connection={...connection,configuration:{...connection.configuration,origin:currentOrigin(f)}};gateway=createRunnerGateway(connection);
 const failed=await gateway.retireOutput(retirement);assert.equal(failed.ok,false);if(failed.ok||failed.error.kind!=='protocol')throw Error(`Expected authenticated unlink failure: ${JSON.stringify(failed).slice(0,2048)}`);
 assert.equal(failed.error.status,503);assert.equal(failed.error.protocol?.retry,'transport');evidence.unlinkFailure=failed.error;
 await gateway.close();gateway=undefined;killAgent(f);assert.deepEqual(retainedAgentCounters(f,f.offer.attemptId),agentBefore);
 evidence.unlinkRecovery=await inspectAndRemoveUnlinkFault(f,f.offer.attemptId);
 metadata=await openMetadata(options.metadata);assert.deepEqual(await metadata.outputDeletions.cleanupAck(key),{kind:'missing'});assert.deepEqual(await metadata.inputs.storage(),before);await metadata.close();metadata=undefined;
 evidence.phase='cold-plan-replay-and-ack';restartAgent(f);await ready();const recovered={...options,agent:{...options.agent,connection:{...connection,configuration:{...connection.configuration,origin:currentOrigin(f)}}}};
 evidence.ackFailure=await lostDriverReply(recovered,ackReply(key));metadata=await openMetadata(options.metadata);const ack=await metadata.outputDeletions.cleanupAck(key);assert.equal(ack.kind,'stored');
 assert.deepEqual(await metadata.inputs.storage(),before);await metadata.close();metadata=undefined;
 f.docker.run(['stop','-t','10',f.agent]);assert.equal(f.docker.json<{State:{ExitCode:number}}[]>(['inspect',f.agent])[0]!.State.ExitCode,0);
 assert.deepEqual(retainedAgentCounters(f,f.offer.attemptId),agentBefore);evidence.proxy=sidecar.close();sidecar=undefined;
 assert.equal(f.docker.run(['ps','-aq','--no-trunc','--filter',`label=dev.beetle.installation=${f.id}`]),'');assert.equal(f.docker.run(['volume','ls','-q','--filter',`label=dev.beetle.installation=${f.id}`]),'');
 assert.deepEqual(await readdir(join(f.root,'staging')),[namespaceCaps.markerName]);
 Object.assign(evidence,{status:'passed',phase:'finished',runId:run.id,deletionId:key.id,ack,chargedBytes:before.chargedBytes,agentCounters:agentBefore,engineExecutions:1,targetCounts:targetCounts(f)});
}catch(error){evidence.status='failed';evidence.failure=error instanceof Error?`${error.name}: ${error.message}`.slice(0,1024):'Unknown failure';evidence.stack=error instanceof Error?error.stack?.slice(0,4096):undefined;process.exitCode=1;}
finally{
 if(app)await app.close().catch(error=>{evidence.applicationCloseFailure=exactError(error);evidence.status='failed';process.exitCode=1;});
 if(gateway)await gateway.close().catch(error=>{evidence.gatewayCloseFailure=exactError(error);evidence.status='failed';process.exitCode=1;});
 if(metadata)await metadata.abort().catch(error=>{evidence.metadataCloseFailure=exactError(error);evidence.status='failed';process.exitCode=1;});
 if(sidecar){try{killAgent(f);evidence.proxy=sidecar.close();}catch(error){evidence.proxyCloseFailure=exactError(error);evidence.status='failed';process.exitCode=1;}}
 try{evidence.diagnosticFailures=await captureLogs(f);f.docker.cleanup(f.id);evidence.removedMailboxVolumes=cleanupLiveVolumes(f);evidence.cleanupVerified=true;}catch(error){evidence.cleanupFailure=exactError(error);evidence.status='failed';process.exitCode=1;}
 evidence.elapsedMs=Date.now()-started;await writeFile(join(f.root,'agent-crash-evidence.json'),JSON.stringify(evidence,null,2),{mode:0o600});console.log(JSON.stringify({status:evidence.status,root:f.root,failure:evidence.failure,cleanupVerified:evidence.cleanupVerified}));
}
