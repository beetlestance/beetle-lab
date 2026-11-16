import {expect,it} from 'vitest';
import {initialize as prior023} from '../backend-settlement/prior023.js';
import {migration024} from '../../src/adapters/outbound/sqlite/migration024.js';
import {migrate025} from '../../src/adapters/outbound/sqlite/migration025.js';
import {migration026} from '../../src/adapters/outbound/sqlite/migration026.js';
import {migration027} from '../../src/adapters/outbound/sqlite/migration027.js';
import {migration028} from '../../src/adapters/outbound/sqlite/migration028.js';
import {migration029} from '../../src/adapters/outbound/sqlite/migration029.js';
import {registerBackendSettlement} from '../../src/adapters/outbound/sqlite/backend-settlement-guard/index.js';
import {registerRetentionAccounting} from '../../src/adapters/outbound/sqlite/retention-accounting-guard/index.js';
import {transaction} from '../../src/adapters/outbound/sqlite/transaction.js';
import {graph,rows} from './clock-reason/fixtures.js';
import {seedFoundation,enqueue} from './execution-foundation-fixtures.js';
function predecessor(){
 const db=prior023(':memory:');registerBackendSettlement(db);registerRetentionAccounting(db);
 transaction(db,()=>db.exec(migration024));transaction(db,()=>migrate025(db));
 for(const sql of [migration026,migration027,migration028])transaction(db,()=>db.exec(sql));
 const store=seedFoundation(db);enqueue(db,store);db.exec('UPDATE runs SET cancellation_requested=1');return db;
}
it('upgrades populated schema28 without inferring historical user intent or rewriting any rows',()=>{
 const db=predecessor();try{
  const before=rows(db);const schema=graph(db);transaction(db,()=>db.exec(migration029));
  expect(rows(db)).toEqual(before);expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(29);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  const unchanged=(value:ReturnType<typeof graph>)=>value.filter(row=>!['output_finalization_evidence','output_absence_evidence'].includes(String(row.name)));
  expect(unchanged(graph(db))).toEqual(unchanged(schema));
 }finally{db.close();}
});
it('rolls back both projection changes and version after a late transaction failure',()=>{
 const db=predecessor();try{
  const before=rows(db);const schema=graph(db);
  expect(()=>transaction(db,()=>{db.exec(migration029);db.exec('SELECT qualification_late_failure()');})).toThrow();
  expect(rows(db)).toEqual(before);expect(graph(db)).toEqual(schema);
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(28);
 }finally{db.close();}
});
