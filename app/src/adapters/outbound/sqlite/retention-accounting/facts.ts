import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { WorkspaceScope,RetentionPolicy,SettingsScope } from '@beetle/contracts/api';
import { captureRetentionSnapshot,RETENTION_SNAPSHOT_BYTES,RETENTION_SNAPSHOT_LIMIT,RETENTION_SNAPSHOT_BODY_BYTES } from '../../../../domain/retention/index.js';
import type { RetentionSnapshot } from '../../../../domain/retention/index.js';
import { storageFits } from '../../../../domain/settings/index.js';
import { StorageError } from '../protocol.js';
export const EPOCH_BYTES=512;
export function requireFact(value:unknown,code:'conflict'|'unavailable'|'capacity_unavailable'='conflict'):asserts value{if(!value)throw new StorageError(code);}
export function accounting(db:DatabaseSync){
 const row=db.prepare('SELECT epoch_count,snapshot_count,charged_bytes,clock_ms FROM retention_storage WHERE id=1').get();
 requireFact(row,'unavailable');
 for(const key of ['epoch_count','snapshot_count','charged_bytes','clock_ms'])requireFact(typeof row[key]==='number'&&Number.isSafeInteger(row[key])&&row[key]>=0,'unavailable');
 const value=row as {epoch_count:number;snapshot_count:number;charged_bytes:number;clock_ms:number};
 requireFact(value.snapshot_count<=RETENTION_SNAPSHOT_LIMIT&&value.charged_bytes===value.epoch_count*EPOCH_BYTES+value.snapshot_count*RETENTION_SNAPSHOT_BYTES,'unavailable');return value;
}
function settings(db:DatabaseSync,scope:WorkspaceScope){
 const keys=['installation',`organization:${scope.organizationId}`,`workspace:${scope.organizationId}:${scope.workspaceId}`];
 return keys.map(key=>{
  const row=db.prepare('SELECT id,version,CASE WHEN length(CAST(value_json AS BLOB))<=32768 THEN value_json END body FROM settings WHERE scope_key=?').get(key);
  requireFact(row&&typeof row.body==='string','unavailable');const body:unknown=JSON.parse(row.body);requireFact(body&&typeof body==='object'&&!Array.isArray(body),'unavailable');
  return{pin:{id:row.id,version:row.version},body:body as Record<string,unknown>};
 });
}
function bindSettings(db:DatabaseSync,input:RetentionSnapshot){
 const [installation,organization,workspace]=settings(db,input.scope);requireFact(installation&&organization&&workspace);
 const expected={installation:installation.pin,organization:organization.pin,workspace:workspace.pin};
 requireFact(encodeCanonicalJson(expected,1024)===encodeCanonicalJson(input.settings,1024));
 const choices:[unknown,SettingsScope][]=[[workspace.body.retention,input.scope],[organization.body.retention,{kind:'organization',organizationId:input.scope.organizationId}],
  [installation.body.retention,{kind:'installation'}]];
 const selected=choices.find(([policy])=>policy!==undefined);requireFact(selected,'unavailable');
 const policy=validateApi('RetentionPolicy',selected[0]);requireFact(policy.ok,'unavailable');
 requireFact(encodeCanonicalJson(policy.value as RetentionPolicy,512)===encodeCanonicalJson(input.policy,512));
 requireFact(encodeCanonicalJson(selected[1],256)===encodeCanonicalJson(input.policySource,256));
 const pool=installation.body.pool;requireFact(pool&&typeof pool==='object'&&!Array.isArray(pool),'unavailable');return pool as Record<string,unknown>;
}
export function prepareReservation(db:DatabaseSync,proposal:unknown,now:number){
 requireFact(db.isTransaction);const snapshot=captureRetentionSnapshot(proposal);const stats=accounting(db);
 requireFact(Number.isSafeInteger(now)&&now>=stats.clock_ms&&now<=8640000000000000);
 requireFact(Date.parse(snapshot.capturedAt)<=now&&Date.parse(snapshot.expiresAt)>now);
 requireFact(stats.snapshot_count<RETENTION_SNAPSHOT_LIMIT,'capacity_unavailable');
 const pool=bindSettings(db,snapshot);const epoch=db.prepare('SELECT epoch FROM retention_workspace_epochs WHERE workspace_id=? AND organization_id=?').get(snapshot.scope.workspaceId,snapshot.scope.organizationId);
 requireFact(epoch?snapshot.epoch===epoch.epoch:snapshot.epoch===1);
 requireFact(!db.prepare('SELECT 1 FROM retention_snapshots WHERE id=? OR (workspace_id=? AND request_id=?) LIMIT 1').get(snapshot.id,snapshot.scope.workspaceId,snapshot.requestId));
 const usage=db.prepare('SELECT charged_bytes FROM installation_storage_usage WHERE id=1').get()?.charged_bytes;
 const newEpoch=!epoch;const charge=RETENTION_SNAPSHOT_BYTES+Number(newEpoch)*EPOCH_BYTES;
 requireFact(typeof usage==='number'&&usage>=stats.charged_bytes&&typeof pool.storageBytes==='number'&&typeof pool.freeSpaceReserveBytes==='number','unavailable');
 requireFact(storageFits({chargedBytes:usage,requestedBytes:charge,allocationBytes:pool.storageBytes,reserveBytes:pool.freeSpaceReserveBytes}),'capacity_unavailable');
 const after={epoch_count:stats.epoch_count+Number(newEpoch),snapshot_count:stats.snapshot_count+1,charged_bytes:stats.charged_bytes+charge,clock_ms:now};
 return{snapshot,body:encodeCanonicalJson(snapshot,RETENTION_SNAPSHOT_BODY_BYTES),newEpoch,usage:[usage,usage+charge] as const,before:stats,after};
}
