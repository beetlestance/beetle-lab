import {expect,it} from 'vitest';
import {initialize as prior023} from '../backend-settlement/prior023.js';
import {migration024} from '../../src/adapters/outbound/sqlite/migration024.js';
import {migrate025} from '../../src/adapters/outbound/sqlite/migration025.js';
import {migration026} from '../../src/adapters/outbound/sqlite/migration026.js';
import {migration027} from '../../src/adapters/outbound/sqlite/migration027.js';
import {migration028} from '../../src/adapters/outbound/sqlite/migration028.js';
import {registerBackendSettlement} from '../../src/adapters/outbound/sqlite/backend-settlement-guard/index.js';
import {registerRetentionAccounting} from '../../src/adapters/outbound/sqlite/retention-accounting-guard/index.js';
import {transaction} from '../../src/adapters/outbound/sqlite/transaction.js';
import {graph,rows} from './clock-reason/fixtures.js';
import {seedFoundation,enqueue} from './execution-foundation-fixtures.js';
function prior027(){
 const db=prior023(':memory:');registerBackendSettlement(db);registerRetentionAccounting(db);
 transaction(db,()=>db.exec(migration024));transaction(db,()=>migrate025(db));
 for(const sql of [migration026,migration027])transaction(db,()=>db.exec(sql));
 const store=seedFoundation(db);enqueue(db,store);return db;
}
function originalRows(db:Parameters<typeof rows>[0]){
 return rows(db).map(table=>table.name==='workspaces'?{...table,rows:table.rows.map(({retired,...row})=>{void retired;return row;})}:table);
}
it('upgrades populated schema027 without rewriting custody, receipts, settings or canonical identities',()=>{
 const db=prior027();try{
  const before=rows(db);transaction(db,()=>db.exec(migration028));
  expect(originalRows(db)).toEqual(before);
  expect(db.prepare('SELECT retired FROM workspaces').get()?.retired).toBe(0);
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(28);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{db.close();}
});
it('rolls a late trigger collision back to the exact populated predecessor schema',()=>{
 const db=prior027();try{
  db.exec('CREATE TRIGGER settings_retired_workspace_delete BEFORE DELETE ON settings BEGIN SELECT 1;END');
  const before=rows(db);const schema=graph(db);
  expect(()=>transaction(db,()=>db.exec(migration028))).toThrow();
  expect(rows(db)).toEqual(before);expect(graph(db)).toEqual(schema);
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(27);
 }finally{db.close();}
});
