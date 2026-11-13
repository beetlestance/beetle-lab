import { checkWindow } from '../runtime-retirement/index.js';
import type { RuntimeAbsent } from '../runtime-retirement/index.js';
import type { Operation } from '../backends/docker/index.js';
import type { RetirementRequest } from '@beetle/contracts/output-retirement';
import type { RetirementPipelineOptions,PipelineNativePorts,PipelineEntry } from './types.js';
import { RetirementPipelineError } from './types.js';
import { pipelineReply } from './reply.js';
export interface PipelineExecution{readonly options:RetirementPipelineOptions;readonly request:RetirementRequest;readonly operation:Operation;
 readonly entry:PipelineEntry;readonly ports?:PipelineNativePorts;closed():boolean}
function check(context:PipelineExecution):void{checkWindow(context.operation,context.closed());}
async function retireRuntime(context:PipelineExecution):Promise<RuntimeAbsent>{
 const{options,request,operation,entry}=context;check(context);const producer=options.producer.retire(request);const barrier=await producer.result;
 try{await producer.settled;}catch(error){entry.uncertain=true;throw error;}check(context);
 if(!barrier.ok)throw new RetirementPipelineError(barrier.reason==='conflict'||barrier.reason==='invalid_input'?'conflict':'unavailable');
 const runtime=await options.runtime.retire(barrier.value,operation);check(context);return runtime;
}
async function ensurePlan(context:PipelineExecution,runtime:RuntimeAbsent):Promise<void>{
 const{options,request,operation,entry,ports}=context;const{organizationId,workspaceId,attemptId,generation}=request;
 const stored=await metadata(context,()=>options.journal.cleanupPlans.read({organizationId,workspaceId,attemptId,generation}));check(context);if(stored)return;
 const native=ports?options.inventory.prepareWithPorts(runtime,operation,ports.inventory):options.inventory.prepare(runtime,operation);entry.native=native;
 const result=await native.result;await native.quiesced;
 try{await native.close();}catch(error){entry.uncertain=true;throw error;}check(context);if(!result.ok)throw new RetirementPipelineError('unavailable');
 await metadata(context,()=>options.inventory.persist(result.observation,operation));check(context);
}
async function removeBatch(context:PipelineExecution,runtime:RuntimeAbsent):Promise<boolean>{
 const{options,operation,ports}=context;
 for(let step=0;step<(options.maximumSteps??16);step++){
  check(context);const progress=await(ports?options.removal.stepWithPorts(runtime,operation,ports.removal):options.removal.step(runtime,operation));check(context);
  if(progress.state==='files_absent')return true;
 }
 return false;
}
export async function executePipeline(context:PipelineExecution){
 const replay=await metadata(context,()=>context.options.journal.settlements.retiredReply(context.request));check(context);
 if(replay)return replay;
 const runtime=await retireRuntime(context);check(context);await ensurePlan(context,runtime);check(context);
 const final=await removeBatch(context,runtime);check(context);if(!final)return pipelineReply(context.request);
 const{options,operation,ports}=context;const receipt=await(ports?options.receipt.finalizeWithPorts(runtime,operation,ports.removal):options.receipt.finalize(runtime,operation));
 check(context);return pipelineReply(context.request,receipt);
}
async function metadata<T>(context:PipelineExecution,issue:()=>Promise<T>):Promise<T>{
 try{return await issue();}catch(error){try{await context.options.journal.retirements.settleCarrier();}catch{context.entry.uncertain=true;}throw error;}
}
