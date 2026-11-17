import assert from 'node:assert/strict';
import type {DatabaseSync} from 'node:sqlite';
import {initialize} from '../../src/adapters/outbound/sqlite/schema.js';
import {migration034} from '../../src/adapters/outbound/sqlite/migration034.js';
import {transaction} from '../../src/adapters/outbound/sqlite/transaction.js';
import {settlementGuards} from '../../src/adapters/outbound/sqlite/backend-settlement/guards.js';
/** Migration 034 narrowed this settlement guard; schema30 carries the original text. */
const suitesGuard=/CREATE TRIGGER settlement_suites_update [\s\S]*?END;/.exec(settlementGuards)![0];
function graph(db:DatabaseSync){
 return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name").all();
}
/** Test-only projection of the current shipped schema back to schema30. Derived latest-run
 * columns and revision Run counts are recomputed by migration 034, so nothing retained is lost. */
export function asSchema30(db:DatabaseSync):void{
 const version=Number(db.prepare('PRAGMA user_version').get()?.user_version);if(version===30)return;
 assert(version===34,'Cannot project fixture to schema30');
 const reference=initialize(':memory:');
 try{assert.deepEqual(graph(db),graph(reference),'Synthetic fixture schema differs from shipped source');}finally{reference.close();}
 transaction(db,()=>{
  for(const match of migration034.matchAll(/CREATE (TRIGGER|INDEX) ([a-z_]+)/g))db.exec(`DROP ${match[1]} ${match[2]}`);
  db.exec(suitesGuard);
  db.exec(`DROP TABLE suite_revision_run_counts;ALTER TABLE suites DROP COLUMN latest_group;
   ALTER TABLE suites DROP COLUMN latest_requested_at;ALTER TABLE suites DROP COLUMN latest_run_id;PRAGMA user_version=30`);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 });
}
