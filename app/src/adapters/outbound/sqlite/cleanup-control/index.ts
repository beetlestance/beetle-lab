import type { DatabaseSync } from 'node:sqlite';
import { BACKEND_CLEANUP_CONTROL_BYTES } from '../../../../ports/cleanup-control.js';
import { storageFits } from '../../../../domain/settings/index.js';
import { StorageError } from '../protocol.js';
export interface CleanupOriginal {readonly attemptId:string;readonly runId:string;readonly organizationId:string;readonly workspaceId:string}
export interface CleanupCapacity {readonly allocationBytes:number;readonly reserveBytes:number}
function present(db:DatabaseSync,key:CleanupOriginal):boolean{
 return !!db.prepare(`SELECT 1 FROM backend_cleanup_controls WHERE attempt_id=? AND run_id=? AND organization_id=? AND workspace_id=?
  AND policy_version=1 AND reserved_bytes=?`).get(key.attemptId,key.runId,key.organizationId,key.workspaceId,BACKEND_CLEANUP_CONTROL_BYTES);
}
/** Original transaction owns admission. Replay never depends on fresh capacity. */
export function reserveCleanupControl(db:DatabaseSync,key:CleanupOriginal,capacity:()=>CleanupCapacity):void{
 if(!db.isTransaction)throw new StorageError('conflict');if(present(db,key))return;
 const requested=capacity();const limits=configuredCapacity(db,requested);const usage=db.prepare('SELECT charged_bytes FROM installation_storage_usage WHERE id=1').get();
 if(typeof usage?.charged_bytes!=='number'||!storageFits({chargedBytes:usage.charged_bytes,requestedBytes:BACKEND_CLEANUP_CONTROL_BYTES,...limits}))throw new StorageError('capacity_unavailable');
 db.prepare(`INSERT INTO backend_cleanup_controls(attempt_id,run_id,organization_id,workspace_id,policy_version,reserved_bytes,allocation_bytes,reserve_bytes)
  VALUES(?,?,?,?,1,?,?,?)`).run(key.attemptId,key.runId,key.organizationId,key.workspaceId,BACKEND_CLEANUP_CONTROL_BYTES,limits.allocationBytes,limits.reserveBytes);
}
/** Missing historical control is unknown debt, never free cleanup permission. */
export function requireCleanupControl(db:DatabaseSync,key:CleanupOriginal):void{
 if(!present(db,key))throw new StorageError('capacity_unavailable');
}
function configuredCapacity(db:DatabaseSync,requested:CleanupCapacity):CleanupCapacity{
 const row=db.prepare(`SELECT json_extract(value_json,'$.pool.storageBytes') allocation,
  json_extract(value_json,'$.pool.freeSpaceReserveBytes') reserve FROM settings WHERE scope_key='installation'`).get();
 if(typeof row?.allocation!=='number'||typeof row.reserve!=='number'||!Number.isSafeInteger(requested.allocationBytes)||!Number.isSafeInteger(requested.reserveBytes)
  ||requested.allocationBytes<0||requested.reserveBytes<0)throw new StorageError('capacity_unavailable');
 return {allocationBytes:Math.min(requested.allocationBytes,row.allocation),reserveBytes:Math.max(requested.reserveBytes,row.reserve)};
}
