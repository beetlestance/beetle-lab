import {expect,it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {faultSql} from './journal-fault.js';
const target='00000000-0000-4000-8000-000000000001';const other='00000000-0000-4000-8000-000000000002';
it('faults only the first reverse file increment for the selected original without advancing its row',()=>{
 // Minimal selector fixture; this does not establish production native or Journal proof.
 const db=new DatabaseSync(':memory:');try{
  db.exec('CREATE TABLE output_cleanup_plans(attempt_id TEXT,plan_json TEXT);CREATE TABLE output_cleanup_progress(attempt_id TEXT PRIMARY KEY,progress_json TEXT);');
  const plan={entries:[{kind:'directory'},{kind:'directory'},{kind:'file'},{kind:'directory'},{kind:'file'},{kind:'directory'}]};
  for(const id of [target,other]){db.prepare('INSERT INTO output_cleanup_plans VALUES(?,?)').run(id,JSON.stringify(plan));db.prepare('INSERT INTO output_cleanup_progress VALUES(?,?)').run(id,JSON.stringify({entryCount:6,removedCount:0}));}
  db.exec(faultSql(target));const advance=(id:string,count:number)=>db.prepare('UPDATE output_cleanup_progress SET progress_json=? WHERE attempt_id=?').run(JSON.stringify({entryCount:6,removedCount:count}),id);
  advance(target,1);expect(()=>advance(target,2)).toThrow('qualification unlink progress failure');expect(JSON.parse(String(db.prepare('SELECT progress_json FROM output_cleanup_progress WHERE attempt_id=?').get(target)?.progress_json)).removedCount).toBe(1);
  advance(other,1);advance(other,2);expect(()=>advance(other,3)).not.toThrow();
  db.prepare('INSERT OR REPLACE INTO output_cleanup_progress VALUES(?,?)').run(target,JSON.stringify({entryCount:6,removedCount:3}));expect(()=>advance(target,4)).not.toThrow();
 }finally{db.close();}
});
