import type {RunnerExportAttemptClient} from '../../ports/export-runner.js';
import type {ExportControl,ExportKey} from '../../ports/exports.js';
import type {ExportOutputBinding} from '../../domain/output-owner/index.js';
import {OutputTransferError} from '../../ports/output-transfer.js';
import type {ExportRuntimeOptions} from './types.js';
const terminal=(value:ExportControl)=>['ready','failed','cancelled'].includes(value.state);
/** One exact original; transport uncertainty leaves persisted custody charged. */
export async function reconcileExport(options:ExportRuntimeOptions,key:ExportKey,signal:AbortSignal):Promise<void>{
 const control=await claimControl(options,key,signal);if(!control)return;
 const binding=control.binding;if(!binding)throw new Error('Export claim missing authority');
 const identity={...binding.key.attempt,journalAuthority:binding.journalAuthority};
 const client=options.gateway.exportAttempt(identity);
 const result=await observeOriginal(options,key,control,client,signal);
 if(!result)return;
 if(!result.ok||signal.aborted)return;
 const job=await options.executions.observe({key,snapshot:result.value,journalAuthority:binding.journalAuthority});
 if(signal.aborted||job.state!=='publishing')return;
 await publish(options,binding,signal);
}
async function publish(options:ExportRuntimeOptions,binding:ExportOutputBinding,signal:AbortSignal):Promise<void>{
 const work=options.transfers.transfer(binding,signal);
 // Always await original settlement, even when the result rejects or shutdown aborts.
 const [result,settled]=await Promise.allSettled([work.result,work.settled]);
 if(settled.status==='rejected')throw settled.reason;
 if(signal.aborted)return;
 if(result.status==='fulfilled'){
  if(result.value.kind==='published')await options.executions.finalize({binding,sourceDigest:result.value.sourceDigest,manifestDigest:result.value.manifestDigest});
  return;
 }
 const error:unknown=result.reason;
 if(!(error instanceof OutputTransferError))throw error;
 if(error.code==='source_absent'){
  const proof=await options.gateway.output({...binding.key.attempt,journalAuthority:binding.journalAuthority}).absence(signal);
  if(proof.ok&&!signal.aborted)await options.outputs.settleAbsence({binding,proof:proof.value});return;
 }
 if(['busy','source_unavailable','transport'].includes(error.code))return;
 throw error;
}

async function observeOriginal(options:ExportRuntimeOptions,key:ExportKey,control:ExportControl,client:RunnerExportAttemptClient,signal:AbortSignal){
 let result;
 if(!control.acknowledged||(control.cancellationRequested&&!control.cancellationDelivered)){
  const original=await options.executions.original(key);if(signal.aborted)return;
  result=control.cancellationRequested?await client.cancelExportOriginal(original.assignment,signal):await client.offerExport(original.assignment,signal);
 }else result=await client.snapshot(signal);
 return result;
}

async function claimControl(options:ExportRuntimeOptions,key:ExportKey,signal:AbortSignal):Promise<ExportControl|undefined>{
 let control=await options.executions.control(key);if(signal.aborted||terminal(control))return;
 if(!control.possibleDelivery){
  const claim=await options.executions.claim(key);if(claim.kind==='blocked'||signal.aborted)return;control=claim.control;
 }
 return control;
}
