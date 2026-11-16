import {expect,it} from 'vitest';
import {initialize as prior023} from '../backend-settlement/prior023.js';
import {migration024} from '../../src/adapters/outbound/sqlite/migration024.js';
import {migrate025} from '../../src/adapters/outbound/sqlite/migration025.js';
import {migration026} from '../../src/adapters/outbound/sqlite/migration026.js';
import {registerBackendSettlement} from '../../src/adapters/outbound/sqlite/backend-settlement-guard/index.js';
import {registerRetentionAccounting} from '../../src/adapters/outbound/sqlite/retention-accounting-guard/index.js';
import {transaction} from '../../src/adapters/outbound/sqlite/transaction.js';
import {graph,rows} from './clock-reason/fixtures.js';
function prior025(){
 const db=prior023(':memory:');registerBackendSettlement(db);registerRetentionAccounting(db);
 transaction(db,()=>db.exec(migration024));transaction(db,()=>migrate025(db));return db;
}
it('upgrades real predecessor schemas without charging or mutating retained rows',()=>{
 const db=prior025();try{
  const before=rows(db);transaction(db,()=>db.exec(migration026));
  expect(rows(db).filter(row=>row.name!=='namespace_deletions')).toEqual(before);
  expect(db.prepare('SELECT count(*) n FROM namespace_deletions').get()?.n).toBe(0);
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(26);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{db.close();}
});
it('rolls a late collision back to exact predecessor schema and counters',()=>{
 const db=prior025();try{
  db.exec('CREATE TRIGGER settings_delete_marker BEFORE DELETE ON settings BEGIN SELECT 1; END');const before=rows(db);const schema=graph(db);
  expect(()=>transaction(db,()=>db.exec(migration026))).toThrow();expect(rows(db)).toEqual(before);expect(graph(db)).toEqual(schema);
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(25);
 }finally{db.close();}
});
