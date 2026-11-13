import { expect,it } from 'vitest';
import { encodeCanonicalJson } from '@beetle/contracts';
import { initialize } from '../../src/journal/schema.js';
import { cleanupControl } from '../../src/cleanup-control/index.js';
import { fixture } from '../cleanup-plans/fixtures.js';
import { asSchema18 } from './legacy.js';
const f=fixture();
it('adds schema19 without changing schema18 plans, retained rows, rootpages or control charges',async()=>{
 const e=await f.prepared();await e.inventory.persist(e.observed,{deadline:performance.now()+10000});await e.owner.close();let db=initialize(e.journalPath);asSchema18(db);
 const schema=db.prepare("SELECT name,type,sql,rootpage FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
 const plans=db.prepare('SELECT * FROM output_cleanup_plans').all();const accepted=db.prepare('SELECT * FROM accepted_attempts').all();const holds=db.prepare('SELECT * FROM disk_holds').all();db.close();
 const journal=await f.open(e.journalPath);expect(await journal.cleanupProgress.read(e.plan)).toBeNull();await journal.cleanupProgress.begin(e.plan);await journal.close();db=initialize(e.journalPath);
 try{expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(20);expect(db.prepare('SELECT * FROM output_cleanup_plans').all()).toEqual(plans);
  expect(db.prepare('SELECT * FROM accepted_attempts').all()).toEqual(accepted);expect(db.prepare('SELECT * FROM disk_holds').all()).toEqual(holds);
  for(const row of schema)expect(db.prepare('SELECT name,type,sql,rootpage FROM sqlite_schema WHERE name=?').get(String(row.name))).toEqual(row);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{db.close();}
});
it('raw SQL refuses progress skips, rollback, changed identity/charge and deletion',async()=>{
 const e=await f.prepared();await e.inventory.persist(e.observed,{deadline:performance.now()+10000});const prepared=await e.owner.cleanupProgress.begin(e.plan);const prior=await e.owner.cleanupProgress.advance(e.plan,{...prepared,state:'cleaning',version:2});await e.owner.close();const db=initialize(e.journalPath);
 try{
  const changed=encodeCanonicalJson({...prior,removedCount:2,version:4},cleanupControl.progressBytes);const bytes=Buffer.byteLength(changed);
  expect(()=>db.prepare('UPDATE output_cleanup_progress SET progress_json=?,encoded_bytes=?,charged_bytes=?').run(changed,bytes,bytes+512)).toThrow('invalid cleanup progress transition');
  const rollback=encodeCanonicalJson({...prior,state:'prepared',version:1},cleanupControl.progressBytes);const size=Buffer.byteLength(rollback);
  expect(()=>db.prepare('UPDATE output_cleanup_progress SET progress_json=?,encoded_bytes=?,charged_bytes=?').run(rollback,size,size+512)).toThrow('invalid cleanup progress transition');
  expect(()=>db.exec("UPDATE output_cleanup_progress SET plan_identity='foreign'" )).toThrow('invalid cleanup progress transition');
  expect(()=>db.exec('UPDATE output_cleanup_progress SET charged_bytes=0')).toThrow();expect(()=>db.exec('DELETE FROM output_cleanup_progress')).toThrow('retained cleanup progress');
  expect(JSON.parse(String(db.prepare('SELECT progress_json FROM output_cleanup_progress').get()?.progress_json))).toEqual(prior);
 }finally{db.close();}
});
