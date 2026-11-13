import { afterEach } from 'vitest';
import { unlink,rmdir } from 'node:fs/promises';
import { fixture as inventoryFixture } from '../task-inventory/fixtures.js';
import { producerBarrierFacts } from '../../src/producer-retirement/index.js';
import { NativeRemoval } from '../../src/native-removal/index.js';
import { NativeReceipt } from '../../src/native-receipt/index.js';
import { RetirementPipeline } from '../../src/retirement-pipeline/index.js';
export function fixture(){const f=inventoryFixture();const closes:(()=>Promise<unknown>)[]=[];afterEach(async()=>{for(const close of closes.splice(0))await Promise.allSettled([close()]);});
 return{...f,async pipeline(maximumSteps=16,originalId?:string){
  const e=await f.inventory(originalId);const removal=new NativeRemoval({journal:e.owner,root:e.staging.root});const receipt=new NativeReceipt({journal:e.owner,root:e.staging.root,removal});
  const pipeline=new RetirementPipeline({journal:e.owner,producer:e.coordinator,runtime:e.runtime,inventory:e.inventory,removal,receipt,maximumSteps});
  closes.push(()=>pipeline.close(),()=>receipt.close(),()=>removal.close());const request=producerBarrierFacts(e.producer,e.owner.retirements).intent.request;const effects:string[]=[];
  const ports={inventory:e.ports,removal:{...e.ports,unlink:async(path:string)=>{effects.push(path);await unlink(path);},rmdir:async(path:string)=>{effects.push(path);await rmdir(path);}}};
  return{...e,pipeline,removal,receipt,request,ports,effects};
 }};
}
