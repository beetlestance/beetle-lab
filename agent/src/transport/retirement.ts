import { encodeJson } from '@beetle/contracts';
import { captureOutputRetirementRequest,captureOutputRetirementReply,OUTPUT_RETIREMENT_REQUEST_BYTES,OUTPUT_RETIREMENT_REPLY_BYTES } from '@beetle/contracts/output-retirement';
import type { FastifyInstance,FastifyRequest } from 'fastify';
import type { AgentHttpOptions } from './types.js';
import { AgentHttpError } from './types.js';
import { RetirementPipelineError } from '../retirement-pipeline/index.js';
import { JournalError } from '../journal/index.js';
import { retirementDigest } from '../retirement-values/index.js';
import { bodyMatches } from './auth.js';
import type { RequestIdentity } from './request-identity.js';
import type { RequestWork } from './work.js';
const path='/runner/v1/attempts/:attemptId/output-retirement';
export function retirementRoute(request:FastifyRequest):boolean{return request.method==='POST'&&request.routeOptions.url===path;}
function failure(error:unknown):unknown{
 if(error instanceof AgentHttpError||error instanceof JournalError)return error;
 if(error instanceof RetirementPipelineError){
  if(error.reason==='invalid_input')return new AgentHttpError(400,'invalid_protocol');
  if(error.reason==='conflict')return new AgentHttpError(409,'conflicting_digest');
  if(error.reason==='capacity')return new AgentHttpError(429,'budget_unavailable','transport');
 }
 return new AgentHttpError(503,'execution_lost','transport');
}
export function registerRetirement(server:FastifyInstance,options:{cleanup:AgentHttpOptions['cleanup'];identity:RequestIdentity;operations:RequestWork}):void{
 server.post(path,{bodyLimit:OUTPUT_RETIREMENT_REQUEST_BYTES},async(request,reply)=>{
  const scope=options.identity.key(request);let body:ReturnType<typeof captureOutputRetirementRequest>;
  try{body=captureOutputRetirementRequest(request.body);}catch{throw new AgentHttpError(400,'invalid_protocol');}
  bodyMatches(scope,scope.attemptId,body);if(body.journalAuthority!==options.identity.journalAuthority)throw new AgentHttpError(409,'conflicting_digest');
  const cleanup=options.cleanup;if(!cleanup)throw new AgentHttpError(503,'execution_lost','transport');
  let result:unknown;
  try{result=await options.operations.source(request,async operation=>{
   const work=cleanup.tick(body,operation);try{return await work.result;}finally{await work.settled;}
  });}catch(error){throw failure(error);}
  try{const value=captureOutputRetirementReply(result,body,retirementDigest);const text=encodeJson(value,OUTPUT_RETIREMENT_REPLY_BYTES);
   reply.code(200).type('application/json; charset=utf-8').serializer(()=>text).send(value);
  }catch{throw new AgentHttpError(500,'invalid_protocol');}
  return reply;
 });
}
