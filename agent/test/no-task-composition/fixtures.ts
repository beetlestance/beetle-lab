import { afterEach } from 'vitest';
import { fixture as installationFixture } from '../installation/fixtures.js';
import { portablePorts } from '../task-inventory/fixtures.js';
import { observation,now,scope } from '../admission/fixtures.js';
import { requestFor } from '../producer-retirement/fixtures.js';
import { ProducerRetirement } from '../../src/producer-retirement/index.js';
import { RuntimeRetirement } from '../../src/runtime-retirement/index.js';
import { TaskInventory } from '../../src/task-inventory/index.js';
import { NativeRemoval } from '../../src/native-removal/index.js';
import { NativeReceipt } from '../../src/native-receipt/index.js';
import { NoTaskReceipt } from '../../src/no-task-receipt/index.js';
import { RetirementPipeline } from '../../src/retirement-pipeline/index.js';
import { DockerBackend } from '../../src/backends/docker/index.js';
import { nodePorts } from '../../src/collection/output/index.js';
import { NoTaskDocker } from '../no-task-receipt/fixtures.js';
export function fixture(){
 const f=installationFixture();const closes:(()=>Promise<unknown>)[]=[];
 afterEach(async()=>{for(const close of closes.splice(0))await Promise.allSettled([close()]);});
 return{...f,async composed(){
  const e=await f.setup();const manager=e.create();const key=scope(e.offer);await e.owner.cancelOriginal({offer:e.offer,now});
  const proof=await e.owner.closeOutputAbsence(key);if(!proof)throw Error('Missing closure');const request=requestFor(proof);
  await e.owner.admission({kind:'observe',observation:observation(Date.now())});
  const producer=new ProducerRetirement({journal:e.owner.retirements,funding:e.owner.retirements,gate:e.options.gate,installation:manager});
  const docker=new NoTaskDocker();const root=e.staging.root;const runtime=new RuntimeRetirement({journal:e.owner,root,catalog:e.catalog,transport:docker,backend:()=>new DockerBackend(docker)});
  const inventory=new TaskInventory({journal:e.owner,root});const removal=new NativeRemoval({journal:e.owner,root});const receipt=new NativeReceipt({journal:e.owner,root,removal});
  const noTask=new NoTaskReceipt({journal:e.owner,root,transport:docker});const pipeline=new RetirementPipeline({journal:e.owner,producer,runtime,inventory,removal,receipt,noTask});
  for(const service of [pipeline,noTask,receipt,removal,inventory,runtime,producer])closes.push(()=>service.close());
  const p=portablePorts();const forbidden=async()=>{throw Error('Unexpected native mutation');};
  const ports={inventory:p.ports,removal:{...p.ports,unlink:forbidden,rmdir:forbidden},noTask:{filesystem:p.ports,timing:nodePorts}};
  return{...e,...p,key,request,manager,producer,docker,noTask,pipeline,ports};
 }};
}
