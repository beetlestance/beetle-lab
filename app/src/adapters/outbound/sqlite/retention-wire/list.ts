import { encodeJson } from '@beetle/contracts';
import type { WorkspaceScope } from '@beetle/contracts/api';
import type { RetentionBatchList,RetentionBatchSummary } from '../../../../ports/retention.js';
import { immutableSnapshot } from '../../../../domain/namespaces/index.js';
import { timestamp } from '../../../../domain/retention/snapshot-fields.js';
import { closed,natural,uuid,scope } from '../output-deletion/values.js';
import { requireFact } from '../retention-accounting/facts.js';
function owner(input:unknown,key:WorkspaceScope){
 const value=scope(input);requireFact(value.organizationId===key.organizationId&&value.workspaceId===key.workspaceId);return value;
}
function summary(input:unknown,key:WorkspaceScope):RetentionBatchSummary{
 closed(input,['id','scope','kind','state','capturedAt','expiresAt','completedAt','candidateCount']);
 requireFact(['retention','manual'].includes(input.kind as string)&&['preview','applied','completed'].includes(input.state as string));natural(input.candidateCount,100);
 const capturedAt=timestamp(input.capturedAt);const expiresAt=timestamp(input.expiresAt);requireFact(Date.parse(expiresAt)===Date.parse(capturedAt)+900000);
 const completedAt=input.completedAt===null?null:timestamp(input.completedAt);requireFact((input.state==='completed')===(completedAt!==null));
 if(completedAt!==null)requireFact(Date.parse(completedAt)>=Date.parse(capturedAt));
 if(input.kind==='manual')requireFact(input.candidateCount===1);if(input.state!=='preview')requireFact(input.candidateCount>0);
 return{...input,id:uuid(input.id),scope:owner(input.scope,key),capturedAt,expiresAt,completedAt} as unknown as RetentionBatchSummary;
}
/** Inventory only; callers fetch actual progress before claiming completion/refund. */
export function captureRetentionList(input:unknown,key:WorkspaceScope):RetentionBatchList{
 const value:unknown=JSON.parse(encodeJson(input,8192));closed(value,['scope','items']);const target=owner(value.scope,key);
 requireFact(Array.isArray(value.items)&&value.items.length<=8);const items=value.items.map(item=>summary(item,target));const seen=new Set<string>();
 for(const item of items){requireFact(!seen.has(item.id));seen.add(item.id);}return immutableSnapshot({scope:target,items});
}
