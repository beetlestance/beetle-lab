import type {RetirementRequest} from '@beetle/contracts/output-retirement';
import {openMetadata} from '../../../../app/src/adapters/outbound/sqlite/index.js';
import {openOutputRuntime} from '../../../../app/src/bootstrap/output-runtime/index.js';
import {createRunnerGateway} from '../../../../app/src/adapters/outbound/runner/index.js';
import type {OutputDeletionKey} from '../../../../app/src/ports/output-deletion-metadata.js';
import type {driverOptions} from './driver.js';
/** Explicit isolated embedding; final ACK still uses the standard installation Root. */
export async function finishBackendFiles(options:ReturnType<typeof driverOptions>,key:OutputDeletionKey){
 const metadata=await openMetadata(options.metadata);let gateway:ReturnType<typeof createRunnerGateway>|undefined;
 let runtime:Awaited<ReturnType<typeof openOutputRuntime>>|undefined;let failure:unknown;let result:RetirementRequest|undefined;const errors:unknown[]=[];
 try{
  gateway=createRunnerGateway(options.agent.connection);runtime=await openOutputRuntime({dataRoot:options.agent.dataRoot,outputs:metadata.outputs,finalizations:metadata.finalizations,absences:metadata.absences,
   observations:metadata.dispatch,runs:metadata.runs,gateway,freeSpaceReserveBytes:options.agent.connection.configuration.freeSpaceReserveBytes,
   deletions:metadata.outputDeletions,fileOnlyDeletion:true,intervalMs:25,onFailure:async error=>{failure=error;}});
  for(let polls=0;polls<400;polls++){
   if(failure)throw failure;const summary=await metadata.outputDeletions.get(key);
   if(summary.stage==='files_absent'){result=await metadata.outputDeletions.retirementRequest(key);break;}
   await new Promise(resolve=>setTimeout(resolve,25));
  }
  if(!result)throw Error('Backend file receipts did not complete');
 }catch(error){errors.push(error);}finally{
  errors.push(...await drain(runtime,gateway,metadata));
 }
 if(errors.length)throw new AggregateError(errors,'Qualification file processing/close failed');
 if(!result)throw Error('No retirement request');return result;
}

async function drain(runtime:Awaited<ReturnType<typeof openOutputRuntime>>|undefined,gateway:ReturnType<typeof createRunnerGateway>|undefined,metadata:Awaited<ReturnType<typeof openMetadata>>):Promise<unknown[]>{
 const errors:unknown[]=[];try{await runtime?.close();}catch(error){errors.push(error);}
 try{await gateway?.close();}catch(error){errors.push(error);}try{await metadata.close();}catch(error){errors.push(error);}return errors;
}
