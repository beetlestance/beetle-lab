import { JOURNAL_SCHEMA_VERSION } from '../../../../agent/src/journal/schema.js';
import { captureAgentTombstone,agentTombstoneDigest,AGENT_TOMBSTONE_JSON_BYTES } from '../../../../agent/src/settlement-values/index.js';
import { encodeCanonicalJson } from '@beetle/contracts';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { Fixture } from '../../../../agent/test/container/fixture.js';
import type { SettlementObservation } from './settlement-replies.js';
/** Independent task-owned offline inspection, never a source of runtime permission. */
export function settledAgent(f:Fixture,observed:SettlementObservation){
 assert.equal(f.docker.json<{State:{Running:boolean}}[]>(['inspect',f.agent])[0]!.State.Running,false);
 const db=new DatabaseSync(join(f.root,'journal','journal.sqlite'),{readOnly:true});const id=observed.request.retirement.attemptId;
 try{
  assert.equal(db.prepare('PRAGMA user_version').get()?.user_version,JOURNAL_SCHEMA_VERSION);
  for(const table of ['accepted_attempts','admission_queue','reservations','disk_holds','task_staging_namespaces','output_retirement_intents',
   'output_cleanup_plans','output_cleanup_progress','output_cleanup_receipts','output_sources','output_delivery_closures','output_no_task_cleanup_receipts','rejected_cleanup_controls']){
   assert.equal(db.prepare(`SELECT count(*) n FROM ${table} WHERE attempt_id=?`).get(id)?.n,0,table);
  }
  const row=db.prepare('SELECT charged_bytes,tombstone_digest,settlement_request_digest,tombstone_json FROM retired_attempts WHERE attempt_id=?').get(id);assert(row);
  assert(typeof row.tombstone_json==='string'&&Buffer.byteLength(row.tombstone_json)<=AGENT_TOMBSTONE_JSON_BYTES);
  const tombstone=captureAgentTombstone(JSON.parse(row.tombstone_json),observed.request);
  assert.equal(encodeCanonicalJson(tombstone,AGENT_TOMBSTONE_JSON_BYTES),row.tombstone_json);assert.equal(agentTombstoneDigest(tombstone,observed.request),row.tombstone_digest);
  assert.equal(row.charged_bytes,4096);assert.equal(row.tombstone_digest,observed.reply.tombstoneDigest);assert.equal(row.settlement_request_digest,observed.reply.requestDigest);
  assert.deepEqual({...db.prepare('SELECT * FROM agent_replay_storage').get()},{id:1,original_count:1,charged_bytes:4096});
  const temporary=db.prepare('SELECT original_count,charged_bytes FROM rejected_cleanup_storage').get();assert.equal(temporary?.original_count,0);assert.equal(temporary.charged_bytes,0);
  const holds=db.prepare('SELECT * FROM disk_retention_stats').get();assert(holds);
  for(const key of ['held_count','held_output_bytes','held_staging_bytes','retained_output_bytes','retained_staging_bytes'])assert.equal(holds[key],0);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);return{tombstone:row,body:tombstone,replay:{...db.prepare('SELECT * FROM agent_replay_storage').get()},holds};
 }finally{db.close();}
}
export function settledBackend(path:string,runId:string,refundedBytes:number,before:number){
 const db=new DatabaseSync(path,{readOnly:true});
 try{
  for(const table of ['runs','attempts','execution_records','execution_intents','backend_cleanup_controls','attempt_output_allocations',
   'output_deletion_intents','execution_output_finalizations','execution_output_sources']){
   const column=table==='runs'?'id':'run_id';assert.equal(db.prepare(`SELECT count(*) n FROM ${table} WHERE ${column}=?`).get(runId)?.n,0,table);
  }
  const usage=db.prepare('SELECT charged_bytes FROM installation_storage_usage WHERE id=1').get()?.charged_bytes;
  assert.equal(usage,before-refundedBytes);assert.equal(usage,2560);
  const row=db.prepare('SELECT charged_bytes,tombstone_digest FROM backend_retired_runs WHERE run_id=?').get(runId);assert.equal(row?.charged_bytes,2560);
  assert.deepEqual({...db.prepare('SELECT * FROM backend_replay_storage').get()},{id:1,original_count:1,charged_bytes:2560});
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);return{usage,tombstone:row};
 }finally{db.close();}
}
