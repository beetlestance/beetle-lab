import { expect } from 'vitest';
import type { SQLOutputValue } from 'node:sqlite';
import { migration017 } from '../../src/journal/migration017.js';
import { migration018 } from '../../src/journal/migration018.js';
import { migration019 } from '../../src/journal/migration019.js';
import { migration020 } from '../../src/journal/migration020.js';
import { migration021 } from '../../src/journal/migration021.js';
import type { DatabaseSync } from 'node:sqlite';
import { initialize } from '../../src/journal/schema.js';
import { initializePrior021 } from './prior021.js';
import { transaction } from '../../src/journal/sql.js';
function triggers(db:DatabaseSync){
 const rows=db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name LIMIT 513").all();
 if(rows.length>512)throw Error('Fixture schema bound');return rows;
}
/** Synthetic empty-prefix projection only. Never discard settled replay identity/debt. */
export function asSchema21(db:DatabaseSync):void{
 const version=db.prepare('PRAGMA user_version').get()?.user_version;if(version===21)return;
 if(![22,23,24,25].includes(Number(version))||db.prepare('SELECT 1 FROM retired_attempts LIMIT 1').get())throw Error('Cannot project settled replay identity');
 requireUnfundedPrefix(db,version);
 const prior=initializePrior021(':memory:');const current=initialize(':memory:');
 try{
  const old=triggers(prior);const newer=triggers(current);const oldNames=new Set(old.map(row=>row.name));
  transaction(db,()=>{
   for(const row of newer){
    const name=String(row.name).replaceAll('"','""');const before=old.find(value=>value.name===row.name);
    if(!oldNames.has(row.name))db.exec(`DROP TRIGGER "${name}"`);
    else if(before?.sql!==row.sql){db.exec(`DROP TRIGGER "${name}"`);db.exec(String(before?.sql));}
   }
   if(Number(version)>=24)db.exec('DROP TABLE rejected_cleanup_receipts');
   if(Number(version)>=23)db.exec('DROP TABLE rejected_cleanup_controls;DROP TABLE rejected_cleanup_storage');
   db.exec('DROP TABLE retired_attempts;DROP TABLE agent_replay_storage;PRAGMA user_version=21');
  });
 }finally{prior.close();current.close();}
}

/** Verify the owning additive migrations before schema022 intentionally amends guards. */
export function verifyUnchangedThrough21(db:DatabaseSync,before:readonly Record<string,SQLOutputValue>[]):void{
 const version=Number(db.prepare('PRAGMA user_version').get()?.user_version);
 if(!Number.isInteger(version)||version<16||version>21)throw Error('Unexpected historical fixture version');
 transaction(db,()=>{
  for(const[index,sql]of [migration017,migration018,migration019,migration020,migration021].entries())if(version<index+17)db.exec(sql);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 });
 for(const row of before)expect(db.prepare('SELECT name,type,sql,rootpage FROM sqlite_schema WHERE name=?').get(String(row.name))).toEqual(row);
}

function requireNoRejectedFunding(db:DatabaseSync,version:unknown):void{
 if(Number(version)>=24&&db.prepare('SELECT 1 FROM rejected_cleanup_receipts LIMIT 1').get())throw Error('Cannot project native rejected receipt');
 if(Number(version)>=23){
  const temporary=db.prepare('SELECT original_count,charged_bytes,last_clock FROM rejected_cleanup_storage WHERE id=1').get();
  if(temporary?.original_count!==0||temporary.charged_bytes!==0||temporary.last_clock!==0
   ||db.prepare('SELECT 1 FROM rejected_cleanup_controls LIMIT 1').get())throw Error('Cannot project rejected cleanup funding');
 }
 }
function requireUnfundedPrefix(db:DatabaseSync,version:unknown):void{
 requireNoRejectedFunding(db,version);
 const debt=db.prepare('SELECT original_count,charged_bytes FROM agent_replay_storage WHERE id=1').get();
 if(debt?.original_count!==0||debt.charged_bytes!==0)throw Error('Cannot project replay debt');

}
