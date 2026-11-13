import type { ProducerBarrier } from '../producer-retirement/index.js';
import { noTaskPipelineReply } from './no-task-reply.js';
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
async function retireProducer(context:PipelineExecution):Promise<ProducerBarrier>{
 const{options,request,entry}=context;check(context);const producer=options.producer.retire(request);const barrier=await producer.result;
 try{await producer.settled;}catch(error){entry.uncertain=true;throw error;}check(context);
 if(!barrier.ok)throw new RetirementPipelineError(barrier.reason==='conflict'||barrier.reason==='invalid_input'?'conflict':'unavailable');
 return barrier.value;
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
 const producer=await retireProducer(context);check(context);
 if(context.options.noTask){
  const selected=await metadata(context,()=>context.options.journal.retirements.select(context.request));check(context);
  if(selected.funding==='rejected')return rejectedNoTask(context,producer);
 }
 const runtime=await context.options.runtime.retire(producer,context.operation);check(context);await ensurePlan(context,runtime);check(context);
 const final=await removeBatch(context,runtime);check(context);if(!final)return pipelineReply(context.request);
 const{options,operation,ports}=context;const receipt=await(ports?options.receipt.finalizeWithPorts(runtime,operation,ports.removal):options.receipt.finalize(runtime,operation));
 check(context);return pipelineReply(context.request,receipt);
}
async function rejectedNoTask(context:PipelineExecution,producer:ProducerBarrier){
 const{options,operation,entry,ports}=context;check(context);const owner=options.noTask;if(!owner)throw new RetirementPipelineError('unavailable');
 const work=ports?.noTask?owner.finalizeWithPorts(producer,operation,ports.noTask):owner.finalize(producer,operation);entry.native=work;
 const result=await work.result;await work.quiesced;
 try{await work.close();}catch(error){entry.uncertain=true;throw error;}check(context);
 if(!result.ok)throw new RetirementPipelineError('unavailable');return noTaskPipelineReply(context.request,result.stored);
}
async function metadata<T>(context:PipelineExecution,issue:()=>Promise<T>):Promise<T>{
 try{return await issue();}catch(error){try{await context.options.journal.retirements.settleCarrier();}catch{context.entry.uncertain=true;}throw error;}
}
