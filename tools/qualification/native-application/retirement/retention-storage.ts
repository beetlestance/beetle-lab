import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import type { WorkspaceScope } from '@beetle/contracts/api';
import { encodeCanonicalJson } from '@beetle/contracts';
import { captureRetentionSnapshot,captureRetentionProgress } from '../../../../app/src/domain/retention/index.js';
export interface RetentionKey {readonly scope:WorkspaceScope;readonly id:string}
/** Read-only, one-original qualification inventory; no guessed metadata allowance. */
export function retainedSnapshotFunding(db:DatabaseSync,key:RetentionKey|undefined,runId:string,phase:'preview'|'settled'){
 const epochs=db.prepare('SELECT workspace_id,organization_id,epoch,charged_bytes FROM retention_workspace_epochs LIMIT 2').all();const pages=db.prepare('SELECT id,organization_id,workspace_id,state,completed_at,charged_bytes,CASE WHEN length(CAST(body_json AS BLOB))<=32768 THEN body_json END bounded_body FROM retention_snapshots LIMIT 2').all();
 const progress=db.prepare("SELECT snapshot_id,ordinal,run_id,deletion_id,request_id,CASE WHEN length(CAST(body_json AS BLOB))<=256 THEN body_json END body_json,CASE WHEN issue_json IS NULL THEN NULL ELSE 'unexpected' END issue_json FROM retention_progress LIMIT 2").all();const stats=db.prepare('SELECT epoch_count,snapshot_count,charged_bytes FROM retention_storage WHERE id=1').get();
 if(!key){assert.equal(epochs.length,0);assert.equal(pages.length,0);assert.equal(progress.length,0);assert.deepEqual({...stats},{epoch_count:0,snapshot_count:0,charged_bytes:0});return{chargedBytes:0,snapshot:null};}
 assert.equal(epochs.length,1);assert.equal(pages.length,1);const row=pages[0]!;const epoch=epochs[0]!;assert.equal(row.id,key.id);assert.equal(row.organization_id,key.scope.organizationId);assert.equal(row.workspace_id,key.scope.workspaceId);
 assert.equal(row.charged_bytes,131072);assert.equal(epoch.charged_bytes,512);assert.equal(epoch.organization_id,key.scope.organizationId);assert.equal(epoch.workspace_id,key.scope.workspaceId);
 assert(typeof row.bounded_body==='string');const snapshot=captureRetentionSnapshot(JSON.parse(row.bounded_body));assert.equal(encodeCanonicalJson(snapshot,32768),row.bounded_body);assert.equal(snapshot.id,key.id);assert.deepEqual(snapshot.scope,key.scope);assert.equal(snapshot.kind,'manual');assert.equal(snapshot.candidates.length,1);assert.equal(snapshot.candidates[0]!.id,runId);
 assert.equal(epoch.epoch,snapshot.epoch+(phase==='preview'?0:2));assert.equal(row.state,phase==='preview'?'preview':'applied');assert.equal(row.completed_at,null);assert.deepEqual({...stats},{epoch_count:1,snapshot_count:1,charged_bytes:131584});
 progressRows(progress,snapshot,phase);return{chargedBytes:131584,snapshot};
}
function progressRows(rows:Record<string,unknown>[],snapshot:ReturnType<typeof captureRetentionSnapshot>,phase:'preview'|'settled'):void{
 if(phase==='preview'){assert.equal(rows.length,0);return;}assert.equal(rows.length,1);const row=rows[0]!;const member=snapshot.candidates[0]!;
 assert.equal(row.snapshot_id,snapshot.id);assert.equal(row.ordinal,0);assert.equal(row.run_id,member.id);assert.equal(row.deletion_id,member.deletionId);assert.equal(row.request_id,member.requestId);assert.equal(row.issue_json,null);
 assert(typeof row.body_json==='string');const body=captureRetentionProgress(JSON.parse(row.body_json));assert.equal(encodeCanonicalJson(body,256),row.body_json);assert.equal(body.phase,'admitted');
}
export function acknowledgedSnapshotFunding(db:DatabaseSync,key:RetentionKey,expectedEpoch:number):void{
 assert.equal(db.prepare('SELECT 1 FROM retention_snapshots LIMIT 1').get(),undefined);assert.equal(db.prepare('SELECT 1 FROM retention_progress LIMIT 1').get(),undefined);
 const rows=db.prepare('SELECT workspace_id,organization_id,epoch,charged_bytes FROM retention_workspace_epochs LIMIT 2').all();assert.equal(rows.length,1);assert.deepEqual({...rows[0]},{workspace_id:key.scope.workspaceId,organization_id:key.scope.organizationId,epoch:expectedEpoch,charged_bytes:512});
 assert.deepEqual({...db.prepare('SELECT epoch_count,snapshot_count,charged_bytes FROM retention_storage WHERE id=1').get()},{epoch_count:1,snapshot_count:0,charged_bytes:512});
 assert.equal(db.prepare('SELECT charged_bytes FROM installation_storage_usage WHERE id=1').get()?.charged_bytes,3072);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
}
