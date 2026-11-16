import { encodeCanonicalJson,validate } from '@beetle/contracts';
import type { OutputCleanupAck,OutputCleanupAckState,OutputDeletionKey } from '../../../../ports/output-deletion-metadata.js';
import { sha256 } from '../input-values.js';
import { closed,hash,natural } from './values.js';
import { requireRule } from '../../../../domain/namespaces/index.js';
/** Bounded data only; the metadata worker owns original provenance, not this codec. */
export function captureCleanupAck(key:OutputDeletionKey,input:unknown):OutputCleanupAck{
 closed(input,['version','reply','replyDigest','logicalBytes']);requireRule(input.version===1);
 const checked=validate('OutputRetirementReply',input.reply);requireRule(checked.ok);const reply=checked.value;
 requireRule(reply.state==='cleaned'&&reply.deletionId===key.id&&reply.runId===key.runId&&reply.organizationId===key.scope.organizationId&&reply.workspaceId===key.scope.workspaceId);
 const body=encodeCanonicalJson(reply,4096);hash(input.replyDigest);natural(input.logicalBytes,4608,512);
 requireRule(input.replyDigest===sha256(body)&&input.logicalBytes===Buffer.byteLength(body)+512);
 return Object.freeze({version:1,reply:Object.freeze(reply),replyDigest:input.replyDigest,logicalBytes:input.logicalBytes});
}
export function captureCleanupAckState(key:OutputDeletionKey,input:unknown):OutputCleanupAckState{
 requireRule(input!==null&&typeof input==='object');const value=input as Record<string,unknown>;
 if(value.kind==='missing'){closed(value,['kind']);return Object.freeze({kind:'missing'});}
 closed(value,['kind','ack']);requireRule(value.kind==='stored');return Object.freeze({kind:'stored',ack:captureCleanupAck(key,value.ack)});
}
