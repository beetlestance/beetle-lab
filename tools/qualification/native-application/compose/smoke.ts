/** Explicit source-image Compose qualification; no user installation is selected. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {exportContentPath,runArtifactContentPath} from '@beetle/contracts/api';
import type {SuiteRevision} from '@beetle/contracts/api';
import {fixture} from './fixture.js';
import {automaticClient,exportReady,readContent,hash} from './public.js';
import {agentState,backendState,targetCounts,engines,cleanup} from './evidence.js';
import {saveRevision,value,finished} from '../public-api.js';
const f=await fixture(process.argv.slice(2));let installation:string|undefined;
const evidence:Record<string,unknown>={status:'running',phase:'startup',transport:'actual frontend/backend/agent/engine containers',
 cleanupVerified:false,architecture:f.architecture,imageIds:f.imageIds,daemonVersion:f.daemonVersion,limits:['Source images built separately once; no registry publication or pull-install claim.','Native arm64 only unless the actual supplied daemon is amd64.','No real browser, in-flight crash, soak or release qualification.']};
console.log(JSON.stringify({state:'started',root:f.root,project:f.project,origin:f.origin}));
try{
 f.compose('up','-d','--no-build');const client=await automaticClient(f.origin);installation=client.installation.id;
 const initial=agentState(f);assert.equal(initial.installationId,installation);assert.equal(initial.engines.length,2);
 evidence.phase='ordinary-run';
 const source=JSON.parse(await readFile('contracts/fixtures/api/valid/suite-revision.json','utf8')) as SuiteRevision;const config=source.config;
 config.target='http://target:8080';config.secrets=[];
 config.requests=[{id:'get',name:'Owned request',method:'GET',path:'/work',query:{},headers:{},assertions:[{id:'required',required:true,kind:'statusEq',value:200}]}];
 config.readiness={path:'/ready',attempts:1,intervalMs:0,timeoutMs:1000,wallBudgetMs:1000,expectedStatus:200,assertions:[]};
 const saved=await saveRevision(client.api,{offer:{config}});const budget=client.installation.values.runDefaults.budget;
 const queued=value(await client.api.createRun({params:saved.params,body:{scope:saved.scope,requestId:randomUUID(),revisionId:saved.revision.id,
  engineProfile:'k6-local',budget,executionPolicy:{mode:'parallel',preferIdle:false}}}));
 const terminal=await finished(client.api,queued,200);
 const artifacts=value(await client.api.listRunArtifacts({params:{...terminal.params,attemptId:queued.activeAttemptId},query:{limit:100}}));
 assert.equal(artifacts.availability,'ready');assert.equal(artifacts.items.length,6);const numeric=artifacts.items.find(item=>item.kind==='numeric-final');assert(numeric&&numeric.bytes<=1048576);
 const numericBytes=await readContent(await client.content(runArtifactContentPath({...terminal.params,attemptId:queued.activeAttemptId,artifactId:numeric.artifactId})),1048576);
 assert.equal(hash(numericBytes),numeric.sha256);
 evidence.phase='offline-export';assert.deepEqual(value(await client.api.getExportProfiles({params:saved.params})).profiles,['k6-local']);
 const exportBody={scope:saved.scope,requestId:randomUUID(),revisionId:saved.revision.id,engineProfile:'k6-local',budget,
  executionPolicy:{mode:'parallel' as const,preferIdle:false},options:{scriptTimeoutMs:180000,maximumBuildBytes:4194304}};
 const exportParams={...saved.params,revisionId:saved.revision.id};const accepted=value(await client.api.createExport({params:exportParams,body:exportBody}));
 const selection={...saved.params,exportId:accepted.id};const job=await exportReady(client.api,selection);assert(job.artifact);
 const scriptPath=exportContentPath(selection);const script=await readContent(await client.content(scriptPath),4194304);
 assert.equal(script.length,job.artifact.bytes);assert.equal(hash(script),job.artifact.sha256);
 const settings=value(await client.api.getWorkspaceSettings({params:saved.params}));
 const changed=value(await client.api.patchWorkspaceSettings({params:saved.params,body:{scope:saved.scope,schemaVersion:2,requestId:randomUUID(),expectedVersion:settings.version,patch:{retention:{mode:'manual'}}}}));
 assert.equal(changed.version,settings.version+1);const cookie=client.cookieDigest();
 evidence.phase='second-up';f.compose('up','-d','--no-build');
 // Explicit ready check also runs while serving owns the real Journal.
 const ready=f.compose('run','--rm','--no-deps','setup');assert.equal((JSON.parse(ready) as {status:string}).status,'unchanged');
 assert.deepEqual(value(await client.api.getWorkspaceSettings({params:saved.params})),changed);
 const afterUp=agentState(f);assert.equal(afterUp.state.credential,initial.state.credential);assert.equal(afterUp.journalAuthority,initial.journalAuthority);
 evidence.phase='restart';f.compose('restart','backend','agent');
 await waitAfterRestart(client);assert.deepEqual(value(await client.api.getBrowserSession()),client.session);assert.equal(client.cookieDigest(),cookie);
 assert.deepEqual(value(await client.api.getRun({params:terminal.params})),terminal.run);
 assert.deepEqual(value(await client.api.getExport({params:selection})),job);
 assert.deepEqual(await readContent(await client.content(scriptPath),4194304),script);
 assert.deepEqual(value(await client.api.createExport({params:exportParams,body:exportBody})),accepted);
 assert.deepEqual(value(await client.api.getWorkspaceSettings({params:saved.params})),changed);
 const reopened=agentState(f);assert.equal(reopened.journalAuthority,initial.journalAuthority);assert.equal(reopened.state.credential,initial.state.credential);
 const backend=backendState(f);const physical=engines(f,installation);const counts=targetCounts(f);
 Object.assign(evidence,{status:'passed',phase:'cleanup',installationId:installation,journalAuthority:initial.journalAuthority,credentialPreserved:true,cookiePreserved:true,
  actualAgentIdentity:reopened.state.uid,actualBackendIdentity:backend.uid,agentEffectiveCapabilities:reopened.state.caps,engineExecutions:physical.length,targetCounts:counts,
  runId:queued.id,runOutcome:terminal.run.outcome,runArtifacts:artifacts.items.length,exportId:job.id,scriptBytes:script.length,scriptSha256:job.artifact.sha256,settingsVersion:changed.version,publicRequests:client.requests()});
}catch(error){evidence.status='failed';evidence.failure=error instanceof Error?`${error.name}: ${error.message}`.slice(0,1024):'Unknown native qualification failure';evidence.stack=error instanceof Error?error.stack?.slice(0,8192):undefined;process.exitCode=1;}
finally{
 try{Object.assign(evidence,await cleanup(f,installation),{cleanupVerified:true});}catch(error){evidence.cleanupVerified=false;evidence.cleanupFailure=error instanceof Error?error.message:'Unknown cleanup failure';evidence.status='failed';process.exitCode=1;}
 await writeFile(join(f.root,'evidence.json'),JSON.stringify(evidence,null,2),{mode:0o600});console.log(JSON.stringify({status:evidence.status,root:f.root,failure:evidence.failure,cleanupVerified:evidence.cleanupVerified}));
}
async function waitAfterRestart(client:Awaited<ReturnType<typeof automaticClient>>):Promise<void>{
 const deadline=performance.now()+30000;
 for(let n=0;n<80&&performance.now()<deadline;n++){const result=await client.api.getInstallationSettings();if(result.ok)return;await new Promise(resolve=>setTimeout(resolve,250));}
 throw Error('Restart readiness deadline');
}
