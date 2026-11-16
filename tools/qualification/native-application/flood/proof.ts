import assert from 'node:assert/strict';
import type {ApiClient,Run} from '@beetle/contracts/api';
import {runArtifactContentPath} from '@beetle/contracts/api';
import {record,counter} from '../../resources/values.js';
import {value} from '../public-api.js';
import {params} from './cases.js';
export async function existingArtifact(api:ApiClient,run:Run,expected:readonly unknown[]){
 const current=value(await api.getRun({params:params(run)}));assert.equal(current.state,'finished');assert.equal(current.outcome,'passed');assert.equal(current.activeAttemptId,run.activeAttemptId);
 const listed=value(await api.listRunArtifacts({params:{...params(run),attemptId:run.activeAttemptId},query:{limit:100}}));assert.equal(listed.availability,'ready');assert.equal(listed.nextCursor,null);assert.equal(listed.items.length,8);
 const projection=(row:unknown)=>{const item=record(row);return {kind:item.kind,bytes:counter(item.bytes),sha256:item.sha256};};
 assert.deepEqual(listed.items.map(projection),expected.map(projection));
 const large=listed.items.find(item=>item.kind==='metric-windows');assert(large&&large.bytes>=7*1048576&&large.bytes<=16777216);
 return {run:current,large,path:runArtifactContentPath({...params(run),attemptId:run.activeAttemptId,artifactId:large.artifactId})};
}
export async function refusal(response:Response){
 assert(response.body);const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
 try{assert([429,503].includes(response.status));for(let n=0;n<32;n++){const part=await reader.read();if(part.done){const row=record(JSON.parse(Buffer.concat(chunks).toString()));assert.equal(row.code,'capacity_unavailable');return {status:response.status,code:row.code};}
  size+=part.value.length;assert(size<=4096);chunks.push(part.value);}throw Error('Refusal body fragment bound');}
 finally{await reader.cancel();reader.releaseLock();}
}
