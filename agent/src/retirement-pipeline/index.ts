import { cleanupAccess,CleanupAccessError } from '../cleanup-access/index.js';
import { encodeCanonicalJson } from '@beetle/contracts';
import { captureOutputRetirementRequest,outputRetirementDigest } from '@beetle/contracts/output-retirement';
import type { RetirementReply } from '@beetle/contracts/output-retirement';
import { captureWindow } from '../runtime-retirement/index.js';
import type { Operation } from '../backends/docker/index.js';
import { retirementDigest } from '../retirement-values/index.js';
import { executePipeline } from './execute.js';
import { RetirementPipelineError } from './types.js';
import type { RetirementPipelineOptions,PipelineNativePorts,PipelineWork,PipelineEntry } from './types.js';
export { RetirementPipelineError } from './types.js';
export type { RetirementPipelineOptions,PipelineNativePorts,PipelineWork } from './types.js';
const owners=new WeakMap<object,RetirementPipeline>();
function rejected(error:unknown):PipelineWork{const result=Promise.reject<RetirementReply>(error);void result.catch(()=>undefined);const settled=Promise.reject<void>(error);void settled.catch(()=>undefined);return{result,settled};}
/** Bounded process-local composition; no endpoint, background queue or refund authority. */
export class RetirementPipeline{
 private readonly entries=new Set<PipelineEntry>();private readonly scopes=new Map<string,PipelineEntry>();private closed=false;private closing:Promise<void>|undefined;private readonly options:RetirementPipelineOptions;
 constructor(options:RetirementPipelineOptions){const steps=options.maximumSteps??16;if(!Number.isSafeInteger(steps)||steps<1||steps>16)throw new RetirementPipelineError('invalid_input');
  if(owners.has(options.journal.retirements))throw new RetirementPipelineError('capacity');this.options=Object.freeze({...options,maximumSteps:steps});owners.set(options.journal.retirements,this);}
 tick(input:unknown,operation:Operation):PipelineWork{return this.tickWithPorts(input,operation);}
 /** Trusted private native fault seam; never exposed by Root's public process port. */
 tickWithPorts(input:unknown,raw:Operation,ports?:PipelineNativePorts):PipelineWork{
  if(this.closed)return rejected(new RetirementPipelineError('closed'));if(this.entries.size>=2)return rejected(new RetirementPipelineError('capacity'));
  const entry:PipelineEntry={uncertain:false};this.entries.add(entry);let operation:Operation;let request:ReturnType<typeof captureOutputRetirementRequest>;
  try{operation=captureWindow(raw);request=captureOutputRetirementRequest(input);const{organizationId,workspaceId,attemptId,generation}=request;
   cleanupAccess(this.options.journal.retirements).assertOpen({organizationId,workspaceId,attemptId,generation});
   entry.id=encodeCanonicalJson({organizationId,workspaceId,attemptId,generation},640);entry.digest=outputRetirementDigest(request,retirementDigest);
   const existing=this.scopes.get(entry.id);if(existing){this.entries.delete(entry);if(existing.digest!==entry.digest)throw new RetirementPipelineError('conflict');return existing.work??rejected(new RetirementPipelineError('capacity'));}
   entry.access=cleanupAccess(this.options.journal.retirements).acquire({organizationId,workspaceId,attemptId,generation});
   this.scopes.set(entry.id,entry);
  }catch(error){this.entries.delete(entry);return rejected(error instanceof RetirementPipelineError?error:new RetirementPipelineError(error instanceof CleanupAccessError?'capacity':'invalid_input'));}
  const result=Promise.resolve().then(()=>executePipeline({options:this.options,request,operation,entry,closed:()=>this.closed,...(ports?{ports}:{})}));
  const settled=result.then(()=>undefined);void settled.catch(()=>undefined);const work=Object.freeze({result,settled});entry.work=work;
  void result.then(()=>this.release(entry),()=>{if(!entry.uncertain)this.release(entry);});return work;
 }
 private release(entry:PipelineEntry):void{entry.access?.release();this.entries.delete(entry);if(entry.id&&this.scopes.get(entry.id)===entry)this.scopes.delete(entry.id);}
 status(){return Object.freeze({retained:this.entries.size,closed:this.closed});}
 close():Promise<void>{if(this.closing)return this.closing;this.closed=true;this.options.noTask?.stop();this.closing=Promise.resolve().then(async()=>{
  await Promise.allSettled([...this.entries].map(entry=>entry.work?.settled));
  if(this.entries.size)throw new RetirementPipelineError('unavailable');});return this.closing;}
}
