import { afterEach } from 'vitest';
import { fixture as stagingFixture } from '../staging/fixtures.js';
import { portablePorts } from '../task-inventory/fixtures.js';
import { requestFor } from '../producer-retirement/fixtures.js';
import { ProducerRetirement } from '../../src/producer-retirement/index.js';
import { NoTaskReceipt } from '../../src/no-task-receipt/index.js';
import { nodePorts } from '../../src/collection/output/index.js';
import { runtimeName } from '../../src/backends/docker/index.js';
import type { DockerRequest,DockerReply,DockerTransport } from '../../src/backends/docker/index.js';
import { observation,now,scope } from '../admission/fixtures.js';
export class NoTaskDocker implements DockerTransport{
 readonly calls:DockerRequest[]=[];container=404;volume=404;daemonId='synthetic-daemon';
 intercept:((input:DockerRequest)=>Promise<DockerReply>|undefined)|undefined;
 async request(input:DockerRequest):Promise<DockerReply>{
  this.calls.push(input);const held=this.intercept?.(input);if(held)return held;
  if(input.path==='/version')return{ok:true,status:200,body:{MinAPIVersion:'1.24',ApiVersion:'1.47'}};
  if(input.path==='/v1.47/info')return{ok:true,status:200,body:{MemoryLimit:true,SwapLimit:true,CpuCfsPeriod:true,CpuCfsQuota:true,PidsLimit:true,
   OSType:'linux',DefaultRuntime:'runc',KernelVersion:'6.6.0',ID:this.daemonId,NCPU:14,MemTotal:16*1024**3}};
  return{ok:true,status:input.path.includes('/volumes/')?this.volume:this.container,body:null};
 }
}
export function fixture(){
 const f=stagingFixture();const owners:NoTaskReceipt[]=[];const producers:ProducerRetirement[]=[];
 afterEach(async()=>{await Promise.allSettled(owners.splice(0).map(owner=>owner.close()));await Promise.allSettled(producers.splice(0).map(owner=>owner.close()));});
 return{...f,async ready(mode:'rejected'|'admitted'='rejected'){
  const e=await f.environment(false);const key=scope(e.offer);if(mode==='rejected')await e.owner.cancelOriginal({offer:e.offer,now});
  else{await f.enqueue(e.owner,e.offer);await f.admit(e.owner,e.offer);await e.owner.admission({kind:'abortUnstarted',key});}
  const proof=await e.owner.closeOutputAbsence(key);if(!proof)throw Error('Missing rejected closure');const request=requestFor(proof);
  await e.owner.acknowledge({protocolVersion:'1.0',...key,throughSeq:proof.finalAgentSeq});
  await e.owner.admission({kind:'observe',observation:observation(Date.now())});
  const producer=new ProducerRetirement({journal:e.owner.retirements,funding:e.owner.retirements,gate:e.options.gate,installation:{retireOutput:async()=>{}}});producers.push(producer);
  const work=producer.retire(request);const result=await work.result;await work.settled;if(!result.ok)throw Error('Missing producer barrier');
  const docker=new NoTaskDocker();const native=new NoTaskReceipt({journal:e.owner,root:e.options.root,transport:docker});owners.push(native);
  const portable=portablePorts();const ports={filesystem:portable.ports,timing:nodePorts};
  const name=runtimeName({...request,installationId:e.configuration.installationId});
  return{...e,key,request,producer,token:result.value,docker,native,...portable,ports,name,task:`${e.rootPath}/${name}`};
 }};
}
