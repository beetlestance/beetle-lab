import {expect,it} from 'vitest';
import {initialize as prior023} from '../backend-settlement/prior023.js';
import {registerBackendSettlement} from '../../src/adapters/outbound/sqlite/backend-settlement-guard/index.js';
import {registerRetentionAccounting} from '../../src/adapters/outbound/sqlite/retention-accounting-guard/index.js';
import {migration024} from '../../src/adapters/outbound/sqlite/migration024.js';
import {migrate025} from '../../src/adapters/outbound/sqlite/migration025.js';
import {migration026} from '../../src/adapters/outbound/sqlite/migration026.js';
import {migration027} from '../../src/adapters/outbound/sqlite/migration027.js';
import {transaction} from '../../src/adapters/outbound/sqlite/transaction.js';
import {seedFoundation} from './execution-foundation-fixtures.js';
import {graph,rows} from './clock-reason/fixtures.js';
function predecessor(){
 const db=prior023(':memory:');registerBackendSettlement(db);registerRetentionAccounting(db);
 transaction(db,()=>db.exec(migration024));transaction(db,()=>migrate025(db));transaction(db,()=>db.exec(migration026));seedFoundation(db);return db;
}
it('adds scoped ordering indexes without changing actual predecessor data or charges',()=>{
 const db=predecessor();try{
  const before=rows(db);transaction(db,()=>db.exec(migration027));expect(rows(db)).toEqual(before);
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(27);
  for(const state of [false,true]){
   const plan=db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM runs WHERE organization_id=? ${state?"AND state='active'":''} ORDER BY requested_at DESC,id DESC LIMIT 8`).all('synthetic');
   expect(plan.some(row=>String(row.detail).includes(state?'runs_org_overview_active':'runs_org_overview_recent'))).toBe(true);
   expect(plan.some(row=>String(row.detail).includes('TEMP B-TREE'))).toBe(false);
  }
 }finally{db.close();}
});
it('rolls a late ordering-index collision back to the full original schema',()=>{
 const db=predecessor();try{
  db.exec('CREATE INDEX runs_org_overview_active ON runs(id)');const schema=graph(db);const before=rows(db);
  expect(()=>transaction(db,()=>db.exec(migration027))).toThrow();expect(rows(db)).toEqual(before);expect(graph(db)).toEqual(schema);
 }finally{db.close();}
});
