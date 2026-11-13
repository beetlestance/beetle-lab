import {validate,encodeCanonicalJson} from '@beetle/contracts';
import {captureOutputRetirementRequest,captureOutputRetirementReply} from '@beetle/contracts/output-retirement';
import type {ClientResult} from '@beetle/contracts';
import type {RetirementRequest,RetirementReply} from '@beetle/contracts/output-retirement';
import type {OutputDeletionSummary} from '../../ports/output-deletion-metadata.js';
import type {OutputFileContext} from '../../ports/output-bytes.js';
import type {RetirementProgress} from './types.js';
import {capacityRefusal,retirementPage,sameDeletion} from './values.js';
import {check} from './step.js';
/** Advisory bounded discovery only; durable metadata remains recovery authority. */
export class Retirements {
 private cursor:string|undefined;
 private candidates:readonly OutputDeletionSummary[]=[];
 private retryAt=0;
 private delay=1000;
 constructor(private readonly options:RetirementProgress){}
 async step(context:OutputFileContext):Promise<void>{
  if(performance.now()<this.retryAt)return;
  check(context);
  const candidate=await this.discover(context);if(!candidate)return;
  const key={id:candidate.id,runId:candidate.runId,scope:candidate.scope};
  if(!await this.reserve(candidate))return;
  check(context);
  const request=captureOutputRetirementRequest(await this.options.metadata.retirementRequest(key));
  bindRequest(request,candidate);
  check(context);const result=await this.options.gateway.retireOutput(request,context.signal);check(context);
  if(!result.ok){
   if(transient(result,request)){this.retryAt=performance.now()+this.delay;this.delay=Math.min(this.delay*2,30000);return;}
   throw Error('Retirement gateway refused');
  }
  const reply=captureOutputRetirementReply(result.value,request,this.options.digest);
  this.retryAt=0;this.delay=1000;
  if(reply.state==='pending')return;
  // Keep the exact immutable reply alive until the metadata carrier actually settles.
  await this.options.metadata.recordCleanupAck({key,reply});check(context);
 }
 private async discover(context:OutputFileContext):Promise<OutputDeletionSummary|undefined>{
  if(this.candidates.length===0){
   const page=retirementPage(await this.options.metadata.scanRetirements({limit:32,...(this.cursor?{cursor:this.cursor}:{})}));
   check(context);this.cursor=page.nextCursor??undefined;this.candidates=page.items;
  }
  const candidate=this.candidates[0];this.candidates=this.candidates.slice(1);return candidate;
 }
 private async reserve(candidate:OutputDeletionSummary):Promise<boolean>{
  const key={id:candidate.id,runId:candidate.runId,scope:candidate.scope};
  try{sameDeletion(await this.options.metadata.reserveControl(key),candidate);return true;}
  catch(error){if(capacityRefusal(error))return false;throw error;}
 }

}
function transient(result:Extract<ClientResult<RetirementReply>,{ok:false}>,request:RetirementRequest):boolean{
 const error=result.error;
 if(error.kind==='transport'||error.kind==='timeout')return true;
 if(error.kind!=='protocol')return false;
 const captured=JSON.parse(encodeCanonicalJson(error.protocol,16384)) as unknown;
 const checked=validate('ProtocolError',captured);if(!checked.ok)return false;
 const value=checked.value;
 return value.organizationId===request.organizationId&&value.workspaceId===request.workspaceId&&value.attemptId===request.attemptId&&value.retry==='transport';
}

function bindRequest(request:RetirementRequest,candidate:OutputDeletionSummary):void{
 if(request.deletionId!==candidate.id||request.runId!==candidate.runId||request.organizationId!==candidate.scope.organizationId||request.workspaceId!==candidate.scope.workspaceId)throw Error('Retirement request mismatch');
}
