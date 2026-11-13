import { encodeCanonicalJson,encodeJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { WorkspaceScope,SettingsScope } from '@beetle/contracts/api';
import { requireRule,sameScope,immutableSnapshot } from '../namespaces/index.js';
import { closed,natural,uuid,timestamp,prefix,nullableUuid } from './snapshot-fields.js';
import { RETENTION_SNAPSHOT_BODY_BYTES,RETENTION_SNAPSHOT_LIFETIME_MS,RETENTION_PROGRESS_BODY_BYTES } from './snapshot-types.js';
import type { RetentionSnapshot,RetentionMember,RetentionSettingsPin,RetentionItemProgress } from './snapshot-types.js';
function settingsPin(input:unknown):RetentionSettingsPin{
 closed(input,['id','version']);natural(input.version,Number.MAX_SAFE_INTEGER,1);return{id:uuid(input.id),version:input.version};
}
function member(input:unknown):RetentionMember{
 closed(input,['id','version','estimatedBytes','reason','deletionId','requestId']);natural(input.version,Number.MAX_SAFE_INTEGER,1);natural(input.estimatedBytes);
 requireRule(['age','completed_count','storage_budget','manual'].includes(input.reason as string));
 return{id:uuid(input.id),version:input.version,estimatedBytes:input.estimatedBytes,reason:input.reason as RetentionMember['reason'],deletionId:uuid(input.deletionId),requestId:uuid(input.requestId)};
}
function cursor(input:unknown):RetentionSnapshot['cursor']{
 if(input===null)return null;closed(input,['requestedAt','id']);return{requestedAt:timestamp(input.requestedAt),id:uuid(input.id)};
}
function exclusions(input:unknown):RetentionSnapshot['exclusions']{
 requireRule(Array.isArray(input)&&input.length<=4);const seen=new Set<string>();let total=0;
 return input.map(item=>{
  closed(item,['reason','count','estimatedBytes']);requireRule(['active','pinned','unknown','cleanup_in_progress'].includes(item.reason as string));
  const reason=item.reason as RetentionSnapshot['exclusions'][number]['reason'];requireRule(!seen.has(reason));seen.add(reason);natural(item.count,100,1);
  if(item.estimatedBytes!==null)natural(item.estimatedBytes);total+=item.count;requireRule(total<=100);
  return{reason,count:item.count,estimatedBytes:item.estimatedBytes};
 });
}
function scope(input:unknown):WorkspaceScope{
 requireRule(validateApi('WorkspaceScope',input).ok);const value=input as WorkspaceScope;
 return{kind:'workspace',organizationId:uuid(value.organizationId),workspaceId:uuid(value.workspaceId)};
}
function policySource(input:unknown,target:WorkspaceScope):SettingsScope{
 requireRule(validateApi('SettingsScope',input).ok);const value=input as SettingsScope;
 if(value.kind==='installation')return{kind:'installation'};
 requireRule(uuid(value.organizationId)===target.organizationId);
 if(value.kind==='organization')return{kind:'organization',organizationId:target.organizationId};
 requireRule(sameScope(value,target));return target;
}
function bindPrefix(snapshot:RetentionSnapshot):void{
 requireRule(snapshot.after.completedCount>=snapshot.before.completedCount&&snapshot.after.completedCount-snapshot.before.completedCount<=snapshot.scanned);
 if(snapshot.before.logicalBytes===null)requireRule(snapshot.after.logicalBytes===null);
 if(snapshot.before.logicalBytes!==null&&snapshot.after.logicalBytes!==null)requireRule(snapshot.after.logicalBytes>=snapshot.before.logicalBytes);
}
function bind(snapshot:RetentionSnapshot):RetentionSnapshot{
 bindPrefix(snapshot);
 requireRule(Date.parse(snapshot.expiresAt)===Date.parse(snapshot.capturedAt)+RETENTION_SNAPSHOT_LIFETIME_MS);
 requireRule(snapshot.id!==snapshot.requestId&&snapshot.predecessorId!==snapshot.id);
 requireRule(!snapshot.hasMore||snapshot.cursor!==null);requireRule(snapshot.candidates.length<=snapshot.scanned);
 requireRule(snapshot.exclusions.reduce((n,item)=>n+item.count,0)+snapshot.candidates.length<=snapshot.scanned);
 const identities=new Set([snapshot.id,snapshot.requestId]);let sum=0;
 for(const item of snapshot.candidates){
  requireRule((snapshot.kind==='manual')===(item.reason==='manual'));
  bindReason(snapshot,item);
  for(const id of [item.id,item.deletionId,item.requestId]){requireRule(!identities.has(id));identities.add(id);}
  requireRule(item.estimatedBytes<=Number.MAX_SAFE_INTEGER-sum);sum+=item.estimatedBytes;
 }
 if(snapshot.kind==='manual')requireRule(snapshot.candidates.length===1&&snapshot.scanned===1&&!snapshot.hasMore&&snapshot.predecessorId===null);
 return snapshot;
}
function bindReason(snapshot:RetentionSnapshot,item:RetentionMember):void{
 if(item.reason==='manual')return;const policy=snapshot.policy;requireRule(policy.mode==='enabled');
 const key={age:'ageDays',completed_count:'completedRunCount',storage_budget:'storageBytes'} as const;
 requireRule(policy[key[item.reason]]!==undefined);
}
/** Bounded immutable data only. The metadata owner supplies settings/epoch/custody authority. */
export function captureRetentionSnapshot(input:unknown):RetentionSnapshot{
 const value:unknown=JSON.parse(encodeJson(input,RETENTION_SNAPSHOT_BODY_BYTES));
 closed(value,['version','id','kind','scope','requestId','intentDigest','capturedAt','expiresAt','settings','policy','policySource','epoch','predecessorId','before','after','scanned','cursor','hasMore','candidates','exclusions']);
 requireRule(value.version===1&&(value.kind==='retention'||value.kind==='manual'));const target=scope(value.scope);
 requireRule(typeof value.intentDigest==='string'&&/^[0-9a-f]{64}$/.test(value.intentDigest));
 closed(value.settings,['installation','organization','workspace']);const policy=validateApi('RetentionPolicy',value.policy);requireRule(policy.ok);
 natural(value.epoch,Number.MAX_SAFE_INTEGER,1);natural(value.scanned,100);requireRule(typeof value.hasMore==='boolean');
 requireRule(Array.isArray(value.candidates)&&value.candidates.length<=100);
 const result:RetentionSnapshot={version:1,id:uuid(value.id),kind:value.kind,scope:target,requestId:uuid(value.requestId),intentDigest:value.intentDigest,
  capturedAt:timestamp(value.capturedAt),expiresAt:timestamp(value.expiresAt),settings:{installation:settingsPin(value.settings.installation),organization:settingsPin(value.settings.organization),workspace:settingsPin(value.settings.workspace)},
  policy:policy.value,policySource:policySource(value.policySource,target),epoch:value.epoch,predecessorId:nullableUuid(value.predecessorId),before:prefix(value.before),after:prefix(value.after),
  scanned:value.scanned,cursor:cursor(value.cursor),hasMore:value.hasMore,candidates:value.candidates.map(member),exclusions:exclusions(value.exclusions)};
 encodeCanonicalJson(result,RETENTION_SNAPSHOT_BODY_BYTES);return immutableSnapshot(bind(result));
}
export function captureRetentionProgress(input:unknown):RetentionItemProgress{
 const value:unknown=JSON.parse(encodeJson(input,RETENTION_PROGRESS_BODY_BYTES));closed(value,['phase','preparedCount','absentCount','fileCount','error']);
 requireRule(['admitted','backend_files','agent_cleanup','settled','blocked'].includes(value.phase as string));
 natural(value.fileCount,128);natural(value.preparedCount,value.fileCount);natural(value.absentCount,value.preparedCount);
 requireRule(value.error===null||['unavailable','conflict','capacity_unavailable','cleanup_failed'].includes(value.error as string));
 requireRule((value.phase==='blocked')===(value.error!==null));
 if(value.phase==='settled'||value.phase==='agent_cleanup')requireRule(value.absentCount===value.fileCount);
 return immutableSnapshot(value as unknown as RetentionItemProgress);
}
