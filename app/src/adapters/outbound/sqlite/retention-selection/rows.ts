import type { DatabaseSync } from 'node:sqlite';
import type { WorkspaceScope } from '@beetle/contracts/api';
import { captureRetentionSnapshot,RETENTION_SNAPSHOT_BODY_BYTES } from '../../../../domain/retention/index.js';
import type { RetentionSnapshot } from '../../../../domain/retention/index.js';
import { encodeCanonicalJson } from '@beetle/contracts';
import { requireFact } from '../retention-accounting/facts.js';
import { StorageError } from '../protocol.js';
import type { Header } from './facts.js';
export function snapshotById(db:DatabaseSync,scope:WorkspaceScope,id:string){
 const row=db.prepare(`SELECT id,state,completed_at,CASE WHEN length(CAST(apply_json AS BLOB))<=2048 THEN apply_json END applied,CASE WHEN length(CAST(body_json AS BLOB))<=32768 THEN body_json END body
  FROM retention_snapshots WHERE id=? AND organization_id=? AND workspace_id=?`).get(id,scope.organizationId,scope.workspaceId);
 if(!row)throw new StorageError('not_found');requireFact(typeof row.body==='string','unavailable');
 const snapshot=captureRetentionSnapshot(JSON.parse(row.body));
 requireFact(snapshot.id===row.id&&encodeCanonicalJson(snapshot,RETENTION_SNAPSHOT_BODY_BYTES)===row.body,'unavailable');return{snapshot,state:row.state,completedAt:row.completed_at,applyBody:row.applied,body:row.body};
}
export function previewHeaders(db:DatabaseSync,scope:WorkspaceScope,limit:number,cursor:RetentionSnapshot['cursor']){
 const after=cursor?' AND (requested_at,id)<(?,?)':'';const args=cursor?[cursor.requestedAt,cursor.id]:[];
 // One extra header is a bounded existence probe, never a fact/candidate evaluation.
 return db.prepare(`SELECT id,version,state,outcome,requested_at FROM runs INDEXED BY runs_overview_recent
  WHERE organization_id=? AND workspace_id=?${after} ORDER BY requested_at DESC,id DESC LIMIT ?`)
  .all(scope.organizationId,scope.workspaceId,...args,limit+1) as unknown as Header[];
}
