import {expect,it} from 'vitest';
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
import {graph,rows} from './clock-reason/fixtures.js';
import {seedFoundation,enqueue} from './execution-foundation-fixtures.js';
function prior029(){
 const db=prior023(':memory:');registerBackendSettlement(db);registerRetentionAccounting(db);
 transaction(db,()=>db.exec(migration024));transaction(db,()=>migrate025(db));
 for(const sql of [migration026,migration027,migration028,migration029])transaction(db,()=>db.exec(sql));
 const store=seedFoundation(db);enqueue(db,store);return db;
}
const added=new Set(['retired','retired_slug']);
function originalRows(db:Parameters<typeof rows>[0]){
 return rows(db).map(table=>table.name==='organizations'?{...table,rows:table.rows.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>!added.has(key))))}:table);
}
it('upgrades populated schema029 without rewriting organisations, settings or custody',()=>{
 const db=prior029();try{
  const before=rows(db);transaction(db,()=>db.exec(migration030));
  expect(originalRows(db)).toEqual(before);
  expect(db.prepare('SELECT retired,retired_slug FROM organizations').get()).toMatchObject({retired:0,retired_slug:null});
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(30);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{db.close();}
});
it('rolls a late trigger collision back to the exact populated predecessor schema',()=>{
 const db=prior029();try{
  db.exec('CREATE TRIGGER settings_retired_organization_delete BEFORE DELETE ON settings BEGIN SELECT 1;END');
  const before=rows(db);const schema=graph(db);
  expect(()=>transaction(db,()=>db.exec(migration030))).toThrow();
  expect(rows(db)).toEqual(before);expect(graph(db)).toEqual(schema);
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(29);
 }finally{db.close();}
});
