import {settleSetup} from './settlement.js';
import type {ProvisionRequest,ProvisionContext} from '../types.js';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {resolve} from 'node:path';
import {enterContainerIdentity} from '../../../agent/src/bootstrap/index.js';
import {UnixDockerTransport} from '../../../agent/src/backends/docker/index.js';
import {provisionFreshInstallation,inspectReadyConfiguration,ProvisionError} from '../index.js';
import {canonical,digest,check} from '../src/capture.js';
import {ComposeHome} from './home.js';
import {ComposeGate} from './gate.js';
import {composeOptions} from './options.js';
import {createStarterRequest} from '../starter.js';
/** Default Compose packaging only; advanced provisioner and serving startup stay separate. */
export async function runComposeSetup(environment:Readonly<Record<string,string|undefined>>):Promise<number>{
 process.umask(0o077);const controller=new AbortController();const stop=()=>controller.abort();
 process.once('SIGINT',stop);process.once('SIGTERM',stop);const operation={signal:controller.signal,deadline:performance.now()+30000};
 let home:ComposeHome|undefined;let gate:ComposeGate|undefined;let success=false;let result:{installationId:string;status:string}|undefined;
 try{
  const captured=composeOptions(environment);home=new ComposeHome(captured.home,{uid:1000,gid:1000},operation);
  await home.prepare();enterContainerIdentity();const fresh=await home.adopt();
  const request=createStarterRequest(captured.options);
  gate=new ComposeGate(home,{uid:1000,gid:1000});await gate.open(fresh,digest(canonical(request)));
  const context={...operation,docker:new UnixDockerTransport('/var/run/docker.sock'),
   agentWorkerUrl:new URL('./agent-worker.js',import.meta.url),backendWorkerUrl:new URL('./backend-worker.js',import.meta.url)};
  result=await initialize({fresh,home,gate,request,context});
  check(operation);await gate.assertPin();success=true;
 }catch(error){process.stderr.write((error instanceof ProvisionError?error.code:'invalid_input')+'\n');}
 finally{
  success=await settleSetup({home,gate,success,operation});
  process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
 }
 if(success&&result){process.stdout.write(JSON.stringify(result)+'\n');return 0;}return 1;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await runComposeSetup(process.env);

async function initialize(input:{fresh:boolean;home:ComposeHome;gate:ComposeGate;request:ProvisionRequest;context:ProvisionContext}){
 const {fresh,home,gate,request,context}=input;
 if(fresh){await home.clearEmptySkeleton();const installed=await provisionFreshInstallation(request,context);
  await gate.ready(installed.installationId);return {installationId:installed.installationId,status:'created'};
 }
 const installed=await inspectReadyConfiguration(request,context);gate.matchInstallation(installed.installationId);return {installationId:installed.installationId,status:'unchanged'};
}

