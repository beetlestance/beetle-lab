import {setTimeout as delay} from 'node:timers/promises';
import {readRootSpace} from '../../../../agent/src/staging/index.js';
import type {VerifiedRoot} from '../../../../agent/src/staging/index.js';
import {daemonResources} from '../../../../agent/src/backends/docker/index.js';
import type {DockerTransport} from '../../../../agent/src/backends/docker/index.js';
import type {ObservationPublisher} from '../../../../agent/src/observation/index.js';
export async function baseline(root:VerifiedRoot,transport:DockerTransport){
 const operation={deadline:performance.now()+3000,signal:AbortSignal.timeout(3000)};
 const space=await readRootSpace(root,operation);if(!space.ok)return {space:{ok:false,reason:space.reason}};
 const version=await transport.request({...operation,method:'GET',path:'/version'});
 const info=await transport.request({...operation,method:'GET',path:'/v1.47/info'});
 const daemon=daemonResources(version,info,space.value.expectedDaemonId);
 return {space:{ok:true,availableBytes:space.value.availableBytes},version:{ok:version.ok,status:version.ok?version.status:null},
  info:{ok:info.ok,status:info.ok?info.status:null},daemon:daemon.ok?{ok:true}:{ok:false,reason:daemon.reason}};
}
/** A failed fixture-readiness gate requests teardown; it never infers process exit. */
export async function ready(publisher:ObservationPublisher){
 const deadline=performance.now()+10000;
 for(let count=0;count<200&&performance.now()<deadline;count++){
  if(publisher.status().ready&&performance.now()<deadline)return;await delay(50);
 }
 throw Error('Benchmark resource readiness gate missed');
}
