import { createHash } from 'node:crypto';
import { encodeJson } from '@beetle/contracts';
import { captureOutputRetirementRequest,captureOutputRetirementReply,OUTPUT_RETIREMENT_REQUEST_BYTES,OUTPUT_RETIREMENT_REPLY_BYTES } from '@beetle/contracts/output-retirement';
import type { RetirementRequest,RetirementReply } from '@beetle/contracts/output-retirement';
import type { ClientResult } from '@beetle/contracts';
import { nativeCall } from './native.js';
import { errorReply } from './source-replies.js';
import { scopeHeaders } from './identity.js';
import type { Connection } from './transport.js';
/** Capture after shared admission; own original DNS/request/response/socket closes. */
export function retireOutput(connection:Connection,input:RetirementRequest,signal?:AbortSignal):Promise<ClientResult<RetirementReply>>{
 return connection.credits.run<RetirementReply>('source',signal,async original=>{
  let request:RetirementRequest;
  try{request=captureOutputRetirementRequest(input);}catch{return {ok:false,error:{kind:'request'}};}
  const identity={organizationId:request.organizationId,workspaceId:request.workspaceId,attemptId:request.attemptId,
   journalAuthority:request.journalAuthority,generation:request.generation,intentDigest:request.intentDigest};
  const response=await nativeCall({origin:connection.origin,method:'POST',
   path:`/runner/v1/attempts/${encodeURIComponent(request.attemptId)}/output-retirement`,
   headers:{authorization:`Bearer ${connection.token}`,...scopeHeaders(identity)},body:encodeJson(request,OUTPUT_RETIREMENT_REQUEST_BYTES),
   signal:original.signal,responseBytes:OUTPUT_RETIREMENT_REPLY_BYTES},connection.io);
  if(!response.ok)return {ok:false,error:{kind:response.kind}};
  if(response.status!==200)return errorReply(response,identity);
  try{return {ok:true,value:captureOutputRetirementReply(response.value,request,text=>createHash('sha256').update(text,'utf8').digest('hex'))};}
  catch{return {ok:false,error:{kind:'response',status:response.status}};}
 });
}
