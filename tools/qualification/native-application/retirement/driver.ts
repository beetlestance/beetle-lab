import assert from 'node:assert/strict';
import {openMetadata} from '../../../../app/src/adapters/outbound/sqlite/index.js';
import type {MetadataOptions} from '../../../../app/src/adapters/outbound/sqlite/index.js';
import {openAgentRuntime,agentMetadata} from '../../../../app/src/bootstrap/agent-runtime.js';
import type {AgentRuntimeOptions} from '../../../../app/src/bootstrap/agent-runtime.js';
import type {OutputDeletionKey} from '../../../../app/src/ports/output-deletion-metadata.js';
import {holdMetadataReply,bounded,record,exactError} from './metadata.js';
interface Options{readonly metadata:MetadataOptions;readonly agent:AgentRuntimeOptions}
export function driverOptions(options:Options){return {...options,metadata:agentMetadata(options.metadata,options.agent)};}
/** Actual production Root composition, retained through the actual aborted worker carrier. */
export async function lostDriverReply(options:Options,matches:(value:unknown)=>boolean){
 const metadata=await openMetadata(options.metadata);const hold=holdMetadataReply(metadata,matches);let runtime:Awaited<ReturnType<typeof openAgentRuntime>>|undefined;
 try{
  runtime=await openAgentRuntime(options.agent,metadata);const value=await bounded(hold.issued,'Expected cleanup reply was not committed');
  await metadata.abort();
  for(let turns=0;turns<16&&runtime.state().status!=='failed';turns++)await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(runtime.state().status,'failed','Worker failure must fence Root before caller close');let failure:unknown;try{await runtime.close();}catch(error){failure=error;}
  assert(failure,'A lost committed worker reply must fence the actual Root');return {value,failure:exactError(failure)};
 }finally{hold.restore();await metadata.abort();if(runtime)await runtime.close().catch(()=>{});}
}
export function fileReply(key:OutputDeletionKey,phase:'prepared'|'absent'){
 return (value:unknown)=>{const row=record(value);return row?.deletionId===key.id&&row.phase===phase;};
}
export function ackReply(key:OutputDeletionKey){
 return (value:unknown)=>{const row=record(value);const reply=record(row?.reply);return row?.version===1&&reply?.deletionId===key.id&&reply.state==='cleaned';};
}
