import {encodeCanonicalJson} from '@beetle/contracts';
import type {OutputBinding} from '../../../domain/output-owner/index.js';
import {captureOutputBinding} from '../../../domain/output-owner/index.js';
import type {OutputCustodyState} from '../../../ports/output-custody.js';
import {requireRule} from '../../../domain/namespaces/index.js';
import {boundedCopy} from './input-values.js';
import {closed,natural} from './output-custody/values.js';
import {decodeArtifact,digest} from './output-custody/slot.js';
/** Shared bounded state decoder; caller retains its exact durable owner type. */
export function captureOutputState<B extends OutputBinding>(input:unknown,binding:B):OutputCustodyState<B>{
 const value=boundedCopy(input,65536) as OutputCustodyState<OutputBinding>;
 closed(value,value.kind==='pending'?['kind','binding']:['kind','binding','manifestDigest','sourceDigest','finalAgentSeq','version','artifacts']);
 requireRule(encodeCanonicalJson(captureOutputBinding(value.binding),4096)===encodeCanonicalJson(binding,4096));
 if(value.kind==='pending')return {kind:'pending',binding};
 requireRule(value.kind==='adopted'&&value.version===1&&Array.isArray(value.artifacts)&&value.artifacts.length<=128);
 requireRule(digest(value.manifestDigest)&&digest(value.sourceDigest));natural(value.finalAgentSeq);
 const tokens=new Set<string>();const artifacts=value.artifacts.map((input,index)=>{
  const artifact=decodeArtifact(input);requireRule(artifact.ordinal===index&&!tokens.has(artifact.token));tokens.add(artifact.token);return artifact;
 });
 return {kind:'adopted',binding,manifestDigest:value.manifestDigest,sourceDigest:value.sourceDigest,finalAgentSeq:value.finalAgentSeq,version:1,artifacts};
}
