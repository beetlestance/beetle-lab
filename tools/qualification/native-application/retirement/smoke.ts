/** Manual actual application/k6/native cleanup qualification. No user installation. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {Docker} from '../../../../agent/test/container/docker.js';
import {fixture,digest} from '../../../../agent/test/container/fixture.js';
import {namespaceCaps} from '../../../../agent/src/staging-namespace/index.js';
import {runtimeName} from '../../../../agent/src/backends/docker/index.js';
import {openApplication} from '../../../../app/src/bootstrap/api.js';
import type {Application} from '../../../../app/src/bootstrap/api.js';
import {openMetadata} from '../../../../app/src/adapters/outbound/sqlite/index.js';
import type {Metadata} from '../../../../app/src/adapters/outbound/sqlite/index.js';
import {prepareOutputDeletion} from '../../../../app/src/application/output-deletion/index.js';
import {argumentsFor,backendConfiguration} from '../configuration.js';
import {provision,targetCounts,captureLogs} from '../containers.js';
import {enqueue,finished,ownedOrigin,publicClient,waitForCapacity} from '../public-api.js';
import {inspectClosed} from '../evidence.js';
import {cleanupLiveVolumes} from '../live-volumes.js';
import {holdMetadataReply,bounded,record,exactError} from './metadata.js';
import {driverOptions,lostDriverReply,fileReply,ackReply} from './driver.js';
import {retirementProxy} from './proxy.js';
const args=argumentsFor(process.argv.slice(2));const f=await fixture(new Docker(args.context,2),args.agentImage,args.engineImage,args.status);
const evidence:Record<string,unknown>={status:'running',phase:'provision',cleanupVerified:false,architecture:f.architecture,platform:process.platform,nodeVersion:process.version,
 agentImage:f.agentImage.Id,engineImage:f.engineImage.Id,limits:['Local native roots and Linux agent/Docker; no release/amd64 claim from an arm64 run.','Agent hard-crash windows are qualified separately.']};
let app:Application|undefined;let metadata:Metadata|undefined;let proxy:Awaited<ReturnType<typeof retirementProxy>>|undefined;
const started=Date.now();console.log(JSON.stringify({state:'started',root:f.root}));
try{
 const origin=await provision(f);const external=await ownedOrigin();const configuration=await backendConfiguration(f,origin,external);assert(configuration.application.agent);
 evidence.phase='application-startup';app=await openApplication(configuration.application);await app.server.listen({...configuration.listen});
 const session=await publicClient(app,external);await waitForCapacity(app);evidence.phase='public-run';const queued=await enqueue(session.api,f);const terminal=await finished(session.api,queued,f.workStatus);
 await app.close();app=undefined;evidence.phase='physical-verification';const physical=await inspectClosed(f,terminal.run,terminal.result);f.offer=physical.offer;f.engine=runtimeName({installationId:f.id,...f.offer,generation:1});
 evidence.phase='lost-intent';const options=driverOptions({metadata:configuration.application.metadata,agent:configuration.application.agent});
 metadata=await openMetadata(options.metadata);const before=await metadata.inputs.storage();const run=await metadata.runs.getRun({scope:terminal.run.scope,id:queued.id});
 const command=prepareOutputDeletion({kind:'beginOutputDeletion',id:randomUUID(),requestedAt:new Date().toISOString(),request:{scope:run.scope,runId:run.id,requestId:randomUUID(),expectedRunVersion:run.version}},digest);
 const hold=holdMetadataReply(metadata,value=>record(value)?.id===command.id);const beginning=metadata.outputDeletions.begin(command);const failed=beginning.then(()=>{throw Error('Lost intent reply unexpectedly returned');},exactError);
 await bounded(hold.issued,'Intent was not committed');await metadata.abort();evidence.intentFailure=await failed;hold.restore();metadata=undefined;
 metadata=await openMetadata(options.metadata);const intent=await metadata.outputDeletions.begin(command);const key={id:intent.id,runId:intent.runId,scope:intent.scope};
 assert(intent.fileCount>0);assert.deepEqual(await metadata.inputs.storage(),before);await metadata.close();metadata=undefined;
 evidence.phase='lost-plan';evidence.planFailure=await lostDriverReply(options,fileReply(key,'prepared'));
 metadata=await openMetadata(options.metadata);assert.equal((await metadata.outputDeletions.getFile({...key,ordinal:0})).phase,'prepared');await metadata.close();metadata=undefined;
 const published=join(options.agent.dataRoot,'outputs','published',run.scope.organizationId,run.scope.workspaceId,run.id,run.activeAttemptId);const initialFiles=await readdir(published);assert(initialFiles.length<=128&&initialFiles.length>0);
 evidence.phase='lost-unlink-progress';evidence.absenceFailure=await lostDriverReply(options,fileReply(key,'absent'));
 assert.equal((await readdir(published)).length,initialFiles.length-1);
 evidence.phase='lost-cleaned-and-ack';proxy=await retirementProxy(origin);
 const throughProxy={...options,agent:{...options.agent,connection:{...options.agent.connection,configuration:{...options.agent.connection.configuration,origin:proxy.origin}}}};
 evidence.ackFailure=await lostDriverReply(throughProxy,ackReply(key));assert(proxy.state().dropped);assert(proxy.state().cleanedReplies>=2);assert.equal(proxy.state().failures,0);evidence.proxy=proxy.state();
 await proxy.close();proxy=undefined;metadata=await openMetadata(options.metadata);const ack=await metadata.outputDeletions.cleanupAck(key);assert.equal(ack.kind,'stored');if(ack.kind!=='stored')throw Error('No ACK');
 assert.equal(ack.ack.reply.state,'cleaned');assert.equal(ack.ack.replyDigest,(evidence.proxy as {cleanedDigest:string}).cleanedDigest);assert.deepEqual(await metadata.outputDeletions.recordCleanupAck({key,reply:ack.ack.reply}),ack.ack);
 assert.deepEqual(await metadata.inputs.storage(),before);assert.deepEqual(await metadata.outputDeletions.scanRetirements({limit:32}),{items:[],nextCursor:null});
 assert.deepEqual(await readdir(published),[]);await metadata.close();metadata=undefined;
 assert.equal(f.docker.run(['ps','-aq','--no-trunc','--filter',`label=dev.beetle.installation=${f.id}`]),'');
 assert.equal(f.docker.run(['volume','ls','-q','--filter',`label=dev.beetle.installation=${f.id}`]),'');
 assert.deepEqual(await readdir(join(f.root,'staging')),[namespaceCaps.markerName]);
 Object.assign(evidence,{status:'passed',phase:'finished',runId:run.id,deletionId:key.id,ack:ack.ack,chargedBytes:before.chargedBytes,engineExecutions:1,targetCounts:targetCounts(f)});
}catch(error){evidence.status='failed';evidence.failure=error instanceof Error?`${error.name}: ${error.message}`.slice(0,1024):'Unknown failure';evidence.stack=error instanceof Error?error.stack?.slice(0,4096):undefined;process.exitCode=1;}
finally{
 if(app)await app.close().catch(error=>{evidence.applicationCloseFailure=exactError(error);evidence.status='failed';process.exitCode=1;});
 if(metadata)await metadata.abort().catch(error=>{evidence.metadataCloseFailure=exactError(error);evidence.status='failed';process.exitCode=1;});
 if(proxy)await proxy.close().catch(error=>{evidence.proxyCloseFailure=exactError(error);evidence.status='failed';process.exitCode=1;});
 try{evidence.diagnosticFailures=await captureLogs(f);f.docker.cleanup(f.id);evidence.removedMailboxVolumes=cleanupLiveVolumes(f);evidence.cleanupVerified=true;}
 catch(error){evidence.cleanupFailure=exactError(error);evidence.status='failed';process.exitCode=1;}
 evidence.elapsedMs=Date.now()-started;await writeFile(join(f.root,'retirement-evidence.json'),JSON.stringify(evidence,null,2),{mode:0o600});
 console.log(JSON.stringify({status:evidence.status,root:f.root,failure:evidence.failure,cleanupVerified:evidence.cleanupVerified}));
}
