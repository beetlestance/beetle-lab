import { createHash } from 'node:crypto';
import { encodeJson } from '@beetle/contracts';
import { captureSettlementRequest,captureSettlementReply,SETTLEMENT_REQUEST_BYTES,SETTLEMENT_REPLY_BYTES } from '@beetle/contracts/output-settlement';
import type { SettlementRequest,SettlementReply } from '@beetle/contracts/output-settlement';
import type { ClientResult } from '@beetle/contracts';
import { nativeCall } from './native.js';
import { errorReply } from './source-replies.js';
import { scopeHeaders } from './identity.js';
import type { Connection } from './transport.js';
/** Capture after shared admission; own original DNS/request/response/socket closes. */
export function settleOutput(connection:Connection,input:SettlementRequest,signal?:AbortSignal):Promise<ClientResult<SettlementReply>>{
 return connection.credits.run<SettlementReply>('source',signal,async original=>{
  let request:SettlementRequest;
  try{request=captureSettlementRequest(input);}catch{return {ok:false,error:{kind:'request'}};}
  const key=request.retirement;const identity={organizationId:key.organizationId,workspaceId:key.workspaceId,attemptId:key.attemptId,
   journalAuthority:key.journalAuthority,generation:key.generation,intentDigest:key.intentDigest};
  const response=await nativeCall({origin:connection.origin,method:'POST',
   path:`/runner/v1/attempts/${encodeURIComponent(key.attemptId)}/output-settlement`,
   headers:{authorization:`Bearer ${connection.token}`,...scopeHeaders(identity)},body:encodeJson(request,SETTLEMENT_REQUEST_BYTES),
   signal:original.signal,responseBytes:SETTLEMENT_REPLY_BYTES},connection.io);
  if(!response.ok)return {ok:false,error:{kind:response.kind}};
  if(response.status!==200)return errorReply(response,identity);
  try{return {ok:true,value:captureSettlementReply(response.value,request,text=>createHash('sha256').update(text,'utf8').digest('hex'))};}
  catch{return {ok:false,error:{kind:'response',status:response.status}};}
 });
}
