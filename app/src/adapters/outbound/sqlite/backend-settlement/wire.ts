import { encodeJson,encodeCanonicalJson,validate } from '@beetle/contracts';
import type { OutputDeletionKey } from '../../../../ports/output-deletion-metadata.js';
import type { BackendSettlementOperation,BackendSettlementWrite,BackendSettlementResult,BackendSettlementValue } from '../../../../ports/output-settlement-metadata.js';
import { closed,natural,hash,uuid,scope } from '../output-deletion/values.js';
import { StorageError } from '../protocol.js';
export function settlementOperation(input:{kind:string}):input is BackendSettlementOperation{
 return input.kind==='settleBackendOutput'||input.kind==='readBackendSettlement';
}
export function settlementKey(input:unknown):OutputDeletionKey{
 closed(input,['scope','id','runId']);return{scope:scope(input.scope),id:uuid(input.id),runId:uuid(input.runId)};
}
export function captureSettlementWrite(input:unknown):BackendSettlementWrite{
 const row:unknown=JSON.parse(encodeJson(input,2048));closed(row,['key','agentReply']);
 const key=settlementKey(row.key);if(row.agentReply===null)return{key,agentReply:null};
 encodeJson(row.agentReply,512);const reply=validate('OutputSettlementReply',row.agentReply);
 if(!reply.ok)throw new StorageError('invalid_input');return{key,agentReply:reply.value};
}
export function captureSettlementOperation(input:unknown):BackendSettlementOperation{
 const row=JSON.parse(encodeJson(input,2304)) as BackendSettlementOperation&{messageId?:number};
 if(!row||!settlementOperation(row))throw new StorageError('invalid_input');
 const field=row.kind==='settleBackendOutput'?'request':'key';const id=Object.hasOwn(row,'messageId');
 closed(row,['kind',field,...(id?['messageId']:[])]);if(id)natural(row.messageId,Number.MAX_SAFE_INTEGER,1);
 return row.kind==='settleBackendOutput'?{kind:row.kind,request:captureSettlementWrite(row.request)}:{kind:row.kind,key:settlementKey(row.key)};
}
function result(input:unknown,key:OutputDeletionKey):BackendSettlementResult{
 closed(input,['version','key','attemptId','kind','refundedBytes','chargedBytes','tombstoneDigest']);
 if(input.version!==1||input.chargedBytes!==2560||!['source','absence','unsent'].includes(String(input.kind)))throw new StorageError('unavailable');
 const captured=settlementKey(input.key);if(encodeCanonicalJson(captured,512)!==encodeCanonicalJson(key,512))throw new StorageError('unavailable');
 natural(input.refundedBytes);hash(input.tombstoneDigest);const attemptId=uuid(input.attemptId);
 return{version:1,key:captured,attemptId,kind:input.kind as BackendSettlementResult['kind'],refundedBytes:input.refundedBytes,chargedBytes:2560,tombstoneDigest:input.tombstoneDigest as string};
}
export function captureSettlementValue(operation:BackendSettlementOperation,input:unknown):BackendSettlementValue{
 const row:unknown=JSON.parse(encodeJson(input,1536));
 if(operation.kind==='settleBackendOutput')return result(row,operation.request.key);
 if(!row||typeof row!=='object')throw new StorageError('unavailable');
 const copy=row as Record<string,unknown>;
 if(copy.kind==='missing'){closed(copy,['kind']);return{kind:'missing'};}
 closed(copy,['kind','settlement']);if(copy.kind!=='settled')throw new StorageError('unavailable');
 return{kind:'settled',settlement:result(copy.settlement,operation.key)};
}
