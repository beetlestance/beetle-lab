import assert from 'node:assert/strict';
import type {DatabaseSync} from 'node:sqlite';
import {initialize as prior023} from '../backend-settlement/prior023.js';
import {migration024} from '../../src/adapters/outbound/sqlite/migration024.js';
import {migrate025} from '../../src/adapters/outbound/sqlite/migration025.js';
import {migration026} from '../../src/adapters/outbound/sqlite/migration026.js';
import {migration027} from '../../src/adapters/outbound/sqlite/migration027.js';
import {migration028} from '../../src/adapters/outbound/sqlite/migration028.js';
import {migration029} from '../../src/adapters/outbound/sqlite/migration029.js';
import {migration030} from '../../src/adapters/outbound/sqlite/migration030.js';
import {registerBackendSettlement} from '../../src/adapters/outbound/sqlite/backend-settlement-guard/index.js';
import {registerRetentionAccounting} from '../../src/adapters/outbound/sqlite/retention-accounting-guard/index.js';
import {transaction} from '../../src/adapters/outbound/sqlite/transaction.js';
import {asSchema30} from './legacy030.js';
function graph(db:DatabaseSync){
 return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name").all();
}
/** Test-only projection of an exact shipped synthetic schema; no retired identity may be rewound. */
export function asSchema27(db:DatabaseSync):void{
 const initial=Number(db.prepare('PRAGMA user_version').get()?.user_version);if(initial===27)return;
 assert([28,29,30,34].includes(initial),'Cannot project fixture to schema27');
 assert(!db.prepare('SELECT 1 FROM workspaces WHERE retired!=0 LIMIT 1').get(),'Cannot project fixture with retired workspace data');
 if(initial>=30)assert(!db.prepare('SELECT 1 FROM organizations WHERE retired!=0 LIMIT 1').get(),'Cannot project fixture with retired organization data');
 if(initial===34)asSchema30(db);const version=Number(db.prepare('PRAGMA user_version').get()?.user_version);
 const reference=prior023(':memory:');registerBackendSettlement(reference);registerRetentionAccounting(reference);
 try{
  transaction(reference,()=>reference.exec(migration024));transaction(reference,()=>migrate025(reference));
  for(const sql of [migration026,migration027])transaction(reference,()=>reference.exec(sql));
  const target=graph(reference);transaction(reference,()=>reference.exec(migration028));
  if(version>=29)transaction(reference,()=>reference.exec(migration029));
  if(version===30)transaction(reference,()=>reference.exec(migration030));
  assert.deepEqual(graph(db),graph(reference),'Synthetic fixture schema differs from shipped source');
  const current=graph(db);const wanted=new Map(target.map(row=>[row.name,row]));
  transaction(db,()=>{
   for(const row of current){
    if(row.type==='table')continue;
    if(wanted.get(row.name)?.sql!==row.sql){assert(typeof row.name==='string'&&/^[a-z_]+$/.test(row.name));assert(['trigger','index','view'].includes(String(row.type)));db.exec(`DROP ${row.type} ${row.name}`);}
   }
   for(const row of target)if(row.type!=='table'&&!current.some(value=>value.name===row.name&&value.sql===row.sql))db.exec(String(row.sql));
   db.exec('ALTER TABLE workspaces DROP COLUMN retired');
   if(version===30)db.exec('ALTER TABLE organizations DROP COLUMN retired_slug;ALTER TABLE organizations DROP COLUMN retired');
   db.exec('PRAGMA user_version=27');assert.deepEqual(graph(db),target);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  });
 }finally{reference.close();}
}
