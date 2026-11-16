import { encodeJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { RetentionStatus,RetentionStatusItem,RetentionStatusKey } from '../../../../ports/retention.js';
import { immutableSnapshot } from '../../../../domain/namespaces/index.js';
import { closed,natural,uuid,scope } from '../output-deletion/values.js';
import { requireFact } from '../retention-accounting/facts.js';
function time(value:unknown):string{
 requireFact(typeof value==='string'&&value.length===24);const parsed=Date.parse(value);requireFact(Number.isFinite(parsed)&&new Date(parsed).toISOString()===value);return value;
}
function counts(value:Record<string,unknown>):void{
 if(value.fileCount===null){requireFact(value.preparedCount===null&&value.absentCount===null&&(value.phase==='blocked'||value.phase==='preview'));return;}
 natural(value.fileCount,128);natural(value.preparedCount,value.fileCount);natural(value.absentCount,value.preparedCount);
 if(['settled','settling','agent_cleanup'].includes(value.phase as string))requireFact(value.absentCount===value.fileCount);
}
function item(input:unknown):RetentionStatusItem{
 closed(input,['runId','runVersion','deletionId','phase','fileCount','preparedCount','absentCount','error','refundedLogicalBytes']);
 requireFact(['preview','admitted','backend_files','agent_cleanup','settling','settled','blocked'].includes(input.phase as string));
 natural(input.runVersion,Number.MAX_SAFE_INTEGER,1);natural(input.refundedLogicalBytes);counts(input);
 requireFact(input.error===null||['unavailable','conflict','capacity_unavailable','cleanup_failed'].includes(input.error as string));
 requireFact((input.phase==='blocked')===(input.error!==null));if(input.phase!=='settled')requireFact(input.refundedLogicalBytes===0);
 else requireFact(input.refundedLogicalBytes>=62976);
 return{...input,runId:uuid(input.runId),deletionId:uuid(input.deletionId)} as unknown as RetentionStatusItem;
}
interface Totals {readonly completedCount:number;readonly refundedLogicalBytes:number;readonly estimatedLogicalBytes:number;readonly state:RetentionStatus['state']}
function bindState(value:Totals,items:readonly RetentionStatusItem[]):void{
 if(value.state==='preview')requireFact(value.completedCount===0&&items.every(child=>child.phase==='preview'));
 if(value.state==='completed')requireFact(items.length>0&&value.completedCount===items.length);
 if(value.state==='applied')requireFact(items.length>0&&value.completedCount<items.length);
}
function bindTotals(value:Totals,items:readonly RetentionStatusItem[]):void{
 const identities=new Set<string>();let refunded=0;
 for(const child of items){requireFact(!identities.has(child.runId)&&!identities.has(child.deletionId));identities.add(child.runId);identities.add(child.deletionId);refunded+=child.refundedLogicalBytes;}
 requireFact(Number.isSafeInteger(refunded)&&refunded===value.refundedLogicalBytes&&refunded<=value.estimatedLogicalBytes&&value.completedCount===items.filter(child=>child.phase==='settled').length);bindState(value,items);
}
/** Closed scope-bound worker data; completion must also be produced by the real worker owner. */
export function captureRetentionStatus(input:unknown,key:RetentionStatusKey):RetentionStatus{
 const value:unknown=JSON.parse(encodeJson(input,32768));closed(value,['id','scope','kind','estimatedLogicalBytes','state','capturedAt','expiresAt','completedAt','items','completedCount','refundedLogicalBytes']);
 requireFact(validateApi('WorkspaceScope',value.scope).ok);const owner=scope(value.scope);const id=uuid(value.id);
 requireFact(id===key.id&&owner.organizationId===key.scope.organizationId&&owner.workspaceId===key.scope.workspaceId);
 requireFact(['preview','applied','completed'].includes(value.state as string)&&['manual','retention'].includes(value.kind as string));
 natural(value.estimatedLogicalBytes);natural(value.completedCount,100);natural(value.refundedLogicalBytes);
 const capturedAt=time(value.capturedAt);const expiresAt=time(value.expiresAt);requireFact(Date.parse(expiresAt)===Date.parse(capturedAt)+900000);
 const completedAt=value.completedAt===null?null:time(value.completedAt);requireFact((value.state==='completed')===(completedAt!==null));
 if(completedAt!==null)requireFact(Date.parse(completedAt)>=Date.parse(capturedAt));
 requireFact(Array.isArray(value.items)&&value.items.length<=100);const items=value.items.map(item);
 bindTotals({completedCount:value.completedCount,refundedLogicalBytes:value.refundedLogicalBytes,estimatedLogicalBytes:value.estimatedLogicalBytes,state:value.state as RetentionStatus['state']},items);
 return immutableSnapshot({...value,id,scope:owner,capturedAt,expiresAt,completedAt,items} as unknown as RetentionStatus);
}
