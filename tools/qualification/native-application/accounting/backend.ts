import type {Artifact} from '@beetle/contracts';
import {executionArtifacts} from '@beetle/contracts';
import assert from 'node:assert/strict';
import type {DatabaseSync} from 'node:sqlite';
import type {Run} from '@beetle/contracts/api';
import type {EventBinding} from '../../../../app/src/ports/events.js';
import {loadOutput} from '../../../../app/src/adapters/outbound/sqlite/output-custody/load.js';
import {readEnvelope} from '../../../../app/src/adapters/outbound/sqlite/output-custody/source.js';
import {outputLocation} from '../../../../app/src/adapters/outbound/files/outputs/paths.js';
import {counter,record} from '../../resources/values.js';
export function debt(original:number,refunded:number,cleanup:number,retention:number,current:number){
 for(const value of [original,refunded,cleanup,retention,current])counter(value);
 assert(original>=refunded);const expected=original-refunded+cleanup+retention;counter(expected);assert.equal(current,expected);
 return {originalAllocationBytes:original,finalizationRefundBytes:refunded,cleanupControlBytes:cleanup,retentionBytes:retention,currentChargedBytes:current};
}
const empty=['input_blobs','export_jobs','namespace_deletions','retention_snapshots','output_deletion_intents','execution_output_absence_finalizations','backend_retired_runs'];
export function backend(db:DatabaseSync,runs:readonly Run[]){
 assert.equal(runs.length,4);
 for(const table of empty)assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n,0,table);
 for(const table of ['runs','execution_records','attempt_output_allocations','execution_output_finalizations','backend_cleanup_controls'])assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n,4,table);
 assert.equal(db.prepare('SELECT charged_bytes FROM backend_replay_storage WHERE id=1').get()!.charged_bytes,0);
 const artifacts=[];const originals=[];let original=0;let refunded=0;let cleanup=0;
 for(const run of runs){
  const row=record(db.prepare(`SELECT e.intent_digest,e.journal_authority,e.execution_charged,e.event_pending,e.output_pending,
   a.charged_bytes,a.maximum_payload_bytes,f.refunded_bytes,f.retained_payload_bytes,c.reserved_bytes
   FROM execution_records e JOIN attempt_output_allocations a USING(attempt_id) JOIN execution_output_finalizations f USING(attempt_id)
   JOIN backend_cleanup_controls c USING(attempt_id) WHERE e.attempt_id=? AND e.run_id=? AND e.organization_id=? AND e.workspace_id=?`).get(run.activeAttemptId,run.id,run.scope.organizationId,run.scope.workspaceId));
  assert.equal(row.execution_charged,0);assert.equal(row.event_pending,0);assert.equal(row.output_pending,1);
  assert.equal(row.maximum_payload_bytes,8388608);assert.equal(row.charged_bytes,8454144);assert.equal(row.reserved_bytes,65536);
  assert.equal(counter(row.refunded_bytes)+counter(row.retained_payload_bytes),8388608);
  original+=counter(row.charged_bytes);refunded+=counter(row.refunded_bytes);cleanup+=counter(row.reserved_bytes);
  assert(typeof row.intent_digest==='string'&&typeof row.journal_authority==='string');
  const binding:EventBinding={key:{runId:run.id,attempt:{organizationId:run.scope.organizationId,workspaceId:run.scope.workspaceId,attemptId:run.activeAttemptId,intentDigest:row.intent_digest,generation:1}},journalAuthority:row.journal_authority};
  const state=loadOutput(db,binding);assert.equal(state.kind,'adopted');if(state.kind!=='adopted')throw Error('Missing adopted output');assert.equal(state.artifacts.length,8);
  const source=readEnvelope(db,binding);assert(source);
  for(const artifact of state.artifacts){const location=outputLocation({binding,artifact});
   const native:Readonly<Artifact>|undefined=executionArtifacts(source.manifest.result)[artifact.ordinal];assert(native);assert.equal(native.sha256,artifact.sha256);assert.equal(native.bytes,artifact.bytes);
   artifacts.push({attemptId:run.activeAttemptId,published:[...location.components,location.name].join('/'),relativePath:native.relativePath,bytes:artifact.bytes,sha256:artifact.sha256});
  }
  const cursor=db.prepare('SELECT retained_bytes,durable_through,ack_confirmed_through,event_count FROM event_cursors WHERE attempt_id=? AND generation=1').get(run.activeAttemptId)!;
  assert.equal(cursor.durable_through,cursor.event_count);assert.equal(cursor.ack_confirmed_through,cursor.event_count);
  const payload=db.prepare("SELECT length(CAST(canonical_json AS BLOB)) bytes FROM execution_output_payloads WHERE attempt_id=? AND kind='manifest'").get(run.activeAttemptId)!;
  const artifactBytes=state.artifacts.reduce((sum,item)=>sum+item.bytes,0);
  assert.equal(counter(row.retained_payload_bytes),counter(cursor.retained_bytes)+counter(payload.bytes)+artifactBytes);
  originals.push({attemptId:run.activeAttemptId,intentDigest:row.intent_digest,artifactBytes,retainedPayloadBytes:counter(row.retained_payload_bytes)});
 }
 const retention=counter(db.prepare('SELECT charged_bytes FROM retention_storage WHERE id=1').get()!.charged_bytes);
 assert.equal(retention,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM retention_workspace_epochs').get()!.n,0);
 const current=counter(db.prepare('SELECT charged_bytes FROM installation_storage_usage WHERE id=1').get()!.charged_bytes);
 return {debt:debt(original,refunded,cleanup,retention,current),artifacts,originals};
}
