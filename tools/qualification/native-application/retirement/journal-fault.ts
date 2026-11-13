import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {captureNativeCleanupPlan,captureCleanupProgress} from '../../../../agent/src/cleanup-control/index.js';
import type {Fixture} from '../../../../agent/test/container/fixture.js';
import {join} from 'node:path';
import {lstat} from 'node:fs/promises';
const trigger='qualification_fail_unlink_progress';
export function faultSql(attemptId:string):string{
 assert(/^[a-f0-9-]{36}$/.test(attemptId));
 return `CREATE TRIGGER ${trigger} BEFORE UPDATE ON output_cleanup_progress
 WHEN NEW.attempt_id='${attemptId}' AND NEW.attempt_id=OLD.attempt_id
 AND json_extract(NEW.progress_json,'$.removedCount')=json_extract(OLD.progress_json,'$.removedCount')+1
 AND json_extract(NEW.progress_json,'$.removedCount')=(
  SELECT json_array_length(p.plan_json,'$.entries')-max(CAST(e.key AS INTEGER))
  FROM output_cleanup_plans p,json_each(p.plan_json,'$.entries') e
  WHERE p.attempt_id=NEW.attempt_id AND json_extract(e.value,'$.kind')='file')
 BEGIN SELECT RAISE(ABORT,'qualification unlink progress failure');END;`;
}

function offline(f:Fixture){
 const state=f.docker.json<{State:{Running:boolean}}[]>(['inspect',f.agent])[0]!;assert.equal(state.State.Running,false);
 return new DatabaseSync(join(f.root,'journal','journal.sqlite'),{enableForeignKeyConstraints:true});
}
export function installUnlinkFault(f:Fixture,attemptId:string){
 const db=offline(f);try{
  assert.equal(db.prepare('SELECT count(*) n FROM runtime_cleanup_associations WHERE attempt_id=?').get(attemptId)?.n,1);
  assert.equal(db.prepare('SELECT count(*) n FROM output_cleanup_progress WHERE attempt_id=?').get(attemptId)?.n,0);
  const before=db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all();db.exec(faultSql(attemptId));
  const after=db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND name!=? ORDER BY name").all(trigger);assert.deepEqual(after,before);
  return {associationPersisted:true,progressRows:0};
 }finally{db.close();}
}
export async function inspectAndRemoveUnlinkFault(f:Fixture,attemptId:string){
 const db=offline(f);try{
  const row=db.prepare('SELECT CASE WHEN length(CAST(p.plan_json AS BLOB))<=131072 THEN p.plan_json END plan,CASE WHEN length(CAST(g.progress_json AS BLOB))<=8192 THEN g.progress_json END progress FROM output_cleanup_plans p JOIN output_cleanup_progress g ON g.attempt_id=p.attempt_id WHERE p.attempt_id=?').get(attemptId);
  assert(row&&typeof row.plan==='string'&&typeof row.progress==='string');const plan=captureNativeCleanupPlan(JSON.parse(row.plan) as unknown);assert.equal(plan.original.attemptId,attemptId);const progress=captureCleanupProgress(JSON.parse(row.progress) as unknown,plan);
  assert.equal(progress.state,'cleaning');const next=plan.entries[plan.entries.length-progress.removedCount-1];assert(next&&next.kind==='file');
  const path=join(f.root,'staging',f.engine,...next.path.split('/'));await assert.rejects(lstat(path),{code:'ENOENT'});
  const before=db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND name!=? ORDER BY name").all(trigger);db.exec(`DROP TRIGGER ${trigger}`);
  assert.deepEqual(db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all(),before);
  return {planIdentity:progress.planIdentity,removedCount:progress.removedCount,entryCount:progress.entryCount,uncommittedAbsentPath:next.path,productionGuardsPreserved:true};
 }finally{db.close();}
}

export function retainedAgentCounters(f:Fixture,attemptId:string){
 const db=offline(f);try{
  const charges=db.prepare('SELECT spool_bytes,snapshot_bytes,checkpoint_bytes,hold_bytes,collection_bytes,source_bytes,delivery_bytes,absence_bytes,cleanup_control_bytes FROM accepted_attempts WHERE attempt_id=?').get(attemptId);assert(charges);
  const totals=db.prepare('SELECT * FROM disk_retention_stats LIMIT 1').get();assert(totals);return {charges,totals};
 }finally{db.close();}
}
