import { encodeJson } from '@beetle/contracts';
import { captureSettlementRequest,captureSettlementReply,SETTLEMENT_REQUEST_BYTES,SETTLEMENT_REPLY_BYTES } from '@beetle/contracts/output-settlement';
import type { FastifyInstance,FastifyRequest } from 'fastify';
import type { AgentHttpOptions } from './types.js';
import { AgentHttpError } from './types.js';
import { StorageSettlementError } from '../storage-settlement/index.js';
import { CleanupAccessError } from '../cleanup-access/index.js';
import { JournalError } from '../journal/index.js';
import { retirementDigest } from '../retirement-values/index.js';
import { bodyMatches } from './auth.js';
import type { RequestIdentity } from './request-identity.js';
import type { RequestWork } from './work.js';
const path='/runner/v1/attempts/:attemptId/output-settlement';
export function settlementRoute(request:FastifyRequest):boolean{return request.method==='POST'&&request.routeOptions.url===path;}
function failure(error:unknown):unknown{
 if(error instanceof AgentHttpError||error instanceof JournalError)return error;
 if(error instanceof CleanupAccessError)return error.reason==='conflict'?new AgentHttpError(409,'conflicting_digest'):new AgentHttpError(429,'budget_unavailable','transport');
 if(error instanceof StorageSettlementError){
  if(error.reason==='invalid_input')return new AgentHttpError(400,'invalid_protocol');
  if(error.reason==='capacity')return new AgentHttpError(429,'budget_unavailable','transport');
 }
 return new AgentHttpError(503,'execution_lost','transport');
}
export function registerSettlement(server:FastifyInstance,options:{settlement:AgentHttpOptions['settlement'];identity:RequestIdentity;operations:RequestWork}):void{
 server.post(path,{bodyLimit:SETTLEMENT_REQUEST_BYTES},async(request,reply)=>{
  const scope=options.identity.key(request);let body:ReturnType<typeof captureSettlementRequest>;
  try{body=captureSettlementRequest(request.body);}catch{throw new AgentHttpError(400,'invalid_protocol');}
  bodyMatches(scope,scope.attemptId,body.retirement);if(body.retirement.journalAuthority!==options.identity.journalAuthority)throw new AgentHttpError(409,'conflicting_digest');
  const settlement=options.settlement;if(!settlement)throw new AgentHttpError(503,'execution_lost','transport');
  let result:unknown;
  try{result=await options.operations.source(request,async operation=>{
   const work=settlement.settle(body,operation);try{return await work.result;}finally{await work.settled;}
  });}catch(error){throw failure(error);}
  try{const value=captureSettlementReply(result,body,retirementDigest);const text=encodeJson(value,SETTLEMENT_REPLY_BYTES);
   reply.code(200).type('application/json; charset=utf-8').serializer(()=>text).send(value);
  }catch{throw new AgentHttpError(500,'invalid_protocol');}
  return reply;
 });
}
