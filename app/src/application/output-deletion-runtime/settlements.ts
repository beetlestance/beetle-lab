import { captureSettlementRequest,captureSettlementReply } from '@beetle/contracts/output-settlement';
import { captureOutputRetirementRequest } from '@beetle/contracts/output-retirement';
import type { OutputDeletionSummary } from '../../ports/output-deletion-metadata.js';
import type { OutputFileContext } from '../../ports/output-bytes.js';
import type { SettlementProgress } from './types.js';
import { settlementPage,sameDeletion,capacityRefusal } from './values.js';
import { check } from './step.js';
import { transportRetry } from './retirements.js';
/** Serial reconciliation; uncertain agent delivery preserves all remaining backend debt. */
export class Settlements {
 private cursor:string|undefined;private candidates:readonly OutputDeletionSummary[]=[];private retryAt=0;private delay=1000;
 constructor(private readonly options:SettlementProgress){}
 async step(context:OutputFileContext):Promise<void>{
  if(performance.now()<this.retryAt)return;check(context);
  const candidate=await this.discover(context);if(!candidate)return;
  const key={id:candidate.id,runId:candidate.runId,scope:candidate.scope};
  try{sameDeletion(await this.options.metadata.reserveControl(key),candidate);}
  catch(error){if(capacityRefusal(error))return;throw error;}
  check(context);
  if(candidate.kind==='unsent'){await this.options.store.settle({key,agentReply:null});check(context);return;}
  const retirement=captureOutputRetirementRequest(await this.options.metadata.retirementRequest(key));
  bindRequest(retirement,key);
  check(context);const state=await this.options.metadata.cleanupAck(key);check(context);
  if(state.kind!=='stored')throw Error('Settlement ACK unavailable');
  const request=captureSettlementRequest({version:1,retirement,cleanupReplyDigest:state.ack.replyDigest});
  const result=await this.options.gateway.settleOutput(request,context.signal);check(context);
  if(!result.ok){
   if(transportRetry(result,retirement)){this.retryAt=performance.now()+this.delay;this.delay=Math.min(30000,this.delay*2);return;}
   throw Error('Settlement gateway refused');
  }
  const agentReply=captureSettlementReply(result.value,request,this.options.digest);this.retryAt=0;this.delay=1000;
  await this.options.store.settle({key,agentReply});check(context);
 }
 private async discover(context:OutputFileContext){
  if(!this.candidates.length){
   const page=settlementPage(await this.options.metadata.scanSettlements({limit:32,...(this.cursor?{cursor:this.cursor}:{})}));
   check(context);this.cursor=page.nextCursor??undefined;this.candidates=page.items;
  }
  const next=this.candidates[0];this.candidates=this.candidates.slice(1);return next;
 }
}

function bindRequest(retirement:ReturnType<typeof captureOutputRetirementRequest>,key:{id:string;runId:string;scope:{organizationId:string;workspaceId:string}}):void{
  if(retirement.deletionId!==key.id||retirement.runId!==key.runId||retirement.organizationId!==key.scope.organizationId
   ||retirement.workspaceId!==key.scope.workspaceId)throw Error('Settlement original mismatch');
}
