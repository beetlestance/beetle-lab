import { unlink,rmdir } from 'node:fs/promises';
import { dirname,isAbsolute,normalize } from 'node:path';
import { captureWindow } from '../runtime-retirement/index.js';
import { captureNativeCleanupPlan,captureCleanupProgress,captureNativeDirectory,captureNativeFile,cleanupDigest } from '../cleanup-control/index.js';
import { nativeCustody,NativeCustodyError } from '../collection/native-custody/index.js';
import { OutputLifetime } from '../collection/output/index.js';
import { nodePorts,OutputFailure } from '../collection/output/index.js';
import type { OutputIO } from '../collection/output/index.js';
import { inventoryPorts } from '../task-inventory/index.js';
import { requireInventory } from '../task-inventory/index.js';
import { preflight } from './preflight.js';
import { StepFiles } from './files.js';
import type { RemovalPorts } from './files.js';
import type { NativeStepInput,NativeStep } from './types.js';
const nativePorts:RemovalPorts={...inventoryPorts,unlink,rmdir};
/** Trusted native leaf only. The coordinator supplies genuine authority and persisted metadata. */
export function startNativeStep(input:NativeStepInput,ports:RemovalPorts=nativePorts):NativeStep{
 const lease=nativeCustody.reserve('cleanup');if(!lease){const done=Promise.resolve();return{result:Promise.resolve({ok:false,reason:'busy'}),quiesced:done,close:()=>done};}
 const owner=new OutputLifetime<Extract<Awaited<NativeStep['result']>,{ok:true}>>(nodePorts,()=>lease.release());lease.own(owner);let files:StepFiles;let permission:()=>void;
 const check=()=>{owner.check();permission();};const io:OutputIO={check,own:handle=>owner.own(handle),closeHandles:handles=>owner.closeHandles(handles),
  io:async action=>{check();const value=await action();check();return value;}};
 owner.start(()=>{
  requireInventory(ports.platform==='linux');permission=input.check;requireInventory(typeof permission==='function');const operation=captureWindow(input.operation);const plan=captureNativeCleanupPlan(input.plan);const progress=captureCleanupProgress(input.progress,plan);
  const directory=input.directory;const{sha256,...marker}=input.installation.marker;requireInventory(cleanupDigest(sha256));const installation={...input.installation,native:captureNativeDirectory(input.installation.native),marker:{...captureNativeFile(marker),sha256}};
  requireInventory(isAbsolute(directory)&&normalize(directory)===directory&&dirname(directory)===installation.directory);
  try{lease.bind(directory);}catch(error){throw new OutputFailure(error instanceof NativeCustodyError&&error.reason==='busy'?'busy':'invalid_options');}
  return{...input,directory,installation,root:captureNativeDirectory(input.root),plan,progress,allowMissing:progress.state!=='prepared',deadline:operation.deadline,...(operation.signal?{signal:operation.signal}:{})};
 },async options=>{
  check();await preflight(options,io,ports);check();let active=options;
  if(options.progress.state==='prepared'){
   requireInventory(typeof options.prepareCleaning==='function');const progress=captureCleanupProgress(await io.io(()=>options.prepareCleaning!()),options.plan);
   requireInventory(progress.state==='cleaning'&&progress.removedCount===0&&progress.version===2);
   active={...options,progress};await preflight(active,io,ports);check();
  }
  files=new StepFiles(active,io,ports);await files.remove();check();
  const prior=active.progress;if(prior.state==='files_absent')return{ok:true,progress:prior};
  const removedCount=prior.removedCount+1;return{ok:true,progress:captureCleanupProgress({...prior,removedCount,version:prior.version+1,
   state:removedCount===prior.entryCount?'files_absent':'cleaning'},options.plan)};
 },async()=>{await files.afterClose();check();});return owner.public;
}
