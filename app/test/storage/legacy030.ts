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
import {migration032} from '../../src/adapters/outbound/sqlite/migration032.js';
import {registerBackendSettlement} from '../../src/adapters/outbound/sqlite/backend-settlement-guard/index.js';
import {registerRetentionAccounting} from '../../src/adapters/outbound/sqlite/retention-accounting-guard/index.js';
import {transaction} from '../../src/adapters/outbound/sqlite/transaction.js';
function graph(db:DatabaseSync){
 return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name").all();
}
/** Test-only projection of schema32 to the shipped schema30; recorded input metadata is never discarded. */
export function asSchema30(db:DatabaseSync):void{
 const version=Number(db.prepare('PRAGMA user_version').get()?.user_version);if(version===30)return;
 assert.equal(version,32,'Cannot project fixture to schema30');
 assert(!db.prepare('SELECT 1 FROM input_blobs WHERE created_at IS NOT NULL OR published_at IS NOT NULL LIMIT 1').get(),'Cannot project fixture with input times');
 assert(!db.prepare('SELECT 1 FROM input_shapes LIMIT 1').get(),'Cannot project fixture with input shapes');
 const reference=prior023(':memory:');registerBackendSettlement(reference);registerRetentionAccounting(reference);
 try{
  transaction(reference,()=>reference.exec(migration024));transaction(reference,()=>migrate025(reference));
  for(const sql of [migration026,migration027,migration028,migration029,migration030])transaction(reference,()=>reference.exec(sql));
  const target=graph(reference);transaction(reference,()=>reference.exec(migration032));
  assert.deepEqual(graph(db),graph(reference),'Synthetic fixture schema differs from shipped source');
  const current=graph(db);const wanted=new Map(target.map(row=>[row.name,row]));
  transaction(db,()=>{
   for(const row of current){
    if(row.type==='table'||wanted.get(row.name)?.sql===row.sql)continue;
    assert(typeof row.name==='string'&&/^[a-z_]+$/.test(row.name));assert(['trigger','index'].includes(String(row.type)));
    db.exec(`DROP ${row.type} ${row.name}`);
   }
   for(const row of target)if(row.type!=='table'&&!current.some(value=>value.name===row.name&&value.sql===row.sql))db.exec(String(row.sql));
   db.exec('DROP TABLE input_shapes;DROP TABLE input_usage_counts');
   db.exec('ALTER TABLE input_blobs DROP COLUMN published_at;ALTER TABLE input_blobs DROP COLUMN created_at');
   db.exec('PRAGMA user_version=30');assert.deepEqual(graph(db),target);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  });
 }finally{reference.close();}
}
