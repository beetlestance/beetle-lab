import { expect,it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import { initialize } from '../../src/journal/schema.js';
import { nativeCleanupPlanIdentity,cleanupControl } from '../../src/cleanup-control/index.js';
import type { NativeCleanupPlan } from '../../src/cleanup-control/index.js';
import { fixture } from './fixtures.js';
import { asSchema17 } from './legacy.js';
const f=fixture();
function insert(db:DatabaseSync,plan:NativeCleanupPlan,verb='INSERT'){
 const json=encodeCanonicalJson(plan,cleanupControl.planBytes);const bytes=Buffer.byteLength(json);
 return db.prepare(`${verb} INTO output_cleanup_plans(attempt_id,plan_identity,plan_json,encoded_bytes,charged_bytes) VALUES(?,?,?,?,?)`)
  .run(plan.original.attemptId,nativeCleanupPlanIdentity(plan),json,bytes,bytes+512);
}
const retained=['accepted_attempts','reservations','disk_holds','disk_retention_stats','event_spool','output_collection_intents','output_sources','output_delivery_closures','output_absence_closures','installed_staging_namespace','task_staging_namespaces','output_retirement_intents'] as const;
function rows(db:DatabaseSync){return Object.fromEntries(retained.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));}
it('migrates schema17 and persists exact worker plan without changing previous rows, schema roots, spool or holds',async()=>{
 const e=await f.prepared();await e.owner.close();let db=initialize(e.journalPath);asSchema17(db);
 const before=rows(db);const schema=db.prepare("SELECT name,type,sql,rootpage FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();db.close();
 const journal=await f.open(e.journalPath);const stored=await journal.cleanupPlans.store(e.plan);await journal.close();db=initialize(e.journalPath);
 try{
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(19);expect(rows(db)).toEqual(before);
  for(const row of schema)expect(db.prepare('SELECT name,type,sql,rootpage FROM sqlite_schema WHERE name=?').get(String(row.name))).toEqual(row);
  const actual=db.prepare('SELECT plan_identity,encoded_bytes,charged_bytes FROM output_cleanup_plans').get();
  expect(actual).toEqual({plan_identity:stored.planIdentity,encoded_bytes:Buffer.byteLength(encodeCanonicalJson(e.plan,cleanupControl.planBytes)),charged_bytes:Buffer.byteLength(encodeCanonicalJson(e.plan,cleanupControl.planBytes))+512});
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{db.close();}
});
it('raw SQL refuses wrong-role plans, replacement/update/delete and forged identity/charge',async()=>{
 const e=await f.prepared();await e.owner.close();const db=initialize(e.journalPath);
 try{
  const wrong={...e.plan,entries:e.plan.entries.map(row=>row.kind==='directory'&&row.path==='output'?{...row,native:{...row.native,ino:'999999999'}}:row)};
  expect(()=>insert(db,wrong)).toThrow('invalid cleanup plan original');insert(db,e.plan);
  expect(()=>insert(db,e.plan,'INSERT OR REPLACE')).toThrow('invalid cleanup plan original');
  expect(()=>db.exec('UPDATE output_cleanup_plans SET plan_json=plan_json')).toThrow('immutable cleanup plan');
  expect(()=>db.exec('DELETE FROM output_cleanup_plans')).toThrow('retained cleanup plan');
  expect(db.prepare('SELECT COUNT(*) AS n FROM output_cleanup_plans').get()?.n).toBe(1);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{db.close();}
});
it('raw SQL cannot insert a plan with incorrect digest or control charge',async()=>{
 const e=await f.prepared();await e.owner.close();const db=initialize(e.journalPath);const json=encodeCanonicalJson(e.plan,cleanupControl.planBytes);const bytes=Buffer.byteLength(json);
 try{
  const statement=db.prepare('INSERT INTO output_cleanup_plans(attempt_id,plan_identity,plan_json,encoded_bytes,charged_bytes) VALUES(?,?,?,?,?)');
  expect(()=>statement.run(e.key.attemptId,'f'.repeat(64),json,bytes,bytes+512)).toThrow();
  expect(()=>statement.run(e.key.attemptId,nativeCleanupPlanIdentity(e.plan),json,bytes,bytes)).toThrow();
  expect(db.prepare('SELECT COUNT(*) AS n FROM output_cleanup_plans').get()?.n).toBe(0);
 }finally{db.close();}
});
