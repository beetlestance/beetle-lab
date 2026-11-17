import {asSchema25} from './legacy025.js';
import {asSchema24} from '../retention/legacy024.js';
import {fixture as retentionFixture} from '../retention/fixture.js';
import {expect,it} from 'vitest';
import {workspaceFixture} from './workspace-retirement-fixture.js';
import {rows,graph} from './clock-reason/fixtures.js';
import {asSchema27} from './legacy027.js';
import {transaction} from '../../src/adapters/outbound/sqlite/transaction.js';
import {migration028} from '../../src/adapters/outbound/sqlite/migration028.js';
import {migration029} from '../../src/adapters/outbound/sqlite/migration029.js';
import {migration030} from '../../src/adapters/outbound/sqlite/migration030.js';
import {migration031} from '../../src/adapters/outbound/sqlite/migration031.js';
import {migration032} from '../../src/adapters/outbound/sqlite/migration032.js';
import {METADATA_SCHEMA_VERSION} from '../../src/adapters/outbound/sqlite/schema.js';
/** Projection drops server-stamped revision metadata that no predecessor could hold. */
function unstamped(tables:ReturnType<typeof rows>){
 return tables.map(table=>table.name==='suite_revisions'?{...table,rows:table.rows.map(row=>({...row,saved_at:null,saved_by:null}))}:table);
}
it('round-trips an exact synthetic predecessor without changing original rows, receipts or charge',()=>{
 const f=workspaceFixture();try{
  const before=unstamped(rows(f.db));asSchema27(f.db);expect(f.db.prepare('PRAGMA user_version').get()?.user_version).toBe(27);
  transaction(f.db,()=>f.db.exec(migration028));transaction(f.db,()=>f.db.exec(migration029));transaction(f.db,()=>f.db.exec(migration030));transaction(f.db,()=>f.db.exec(migration031));
  transaction(f.db,()=>f.db.exec(migration032));
  expect(rows(f.db)).toEqual(before);expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{f.db.close();}
});
it('refuses retired identities and unknown schema before any fixture mutation',()=>{
 for(const kind of ['retired','schema']){
  const f=workspaceFixture();try{
   if(kind==='retired')f.store.execute({kind:'deleteNamespace',command:f.deletion()});
   else f.db.exec('CREATE TABLE unknown_fixture(canary TEXT)');
   const before=rows(f.db);const schema=graph(f.db);
   expect(()=>asSchema27(f.db)).toThrow();expect(rows(f.db)).toEqual(before);expect(graph(f.db)).toEqual(schema);
   expect(f.db.prepare('PRAGMA user_version').get()?.user_version).toBe(METADATA_SCHEMA_VERSION);
  }finally{f.db.close();}
 }
});

it('refuses chained namespace and paid-retention projection before changing schema or rows',()=>{
 const workspace=workspaceFixture();try{
  workspace.store.execute({kind:'deleteNamespace',command:workspace.deletion()});const before=rows(workspace.db);const schema=graph(workspace.db);
  expect(()=>asSchema25(workspace.db)).toThrow('namespace deletion data');expect(rows(workspace.db)).toEqual(before);expect(graph(workspace.db)).toEqual(schema);
  expect(workspace.db.prepare('PRAGMA user_version').get()?.user_version).toBe(METADATA_SCHEMA_VERSION);
 }finally{workspace.db.close();}
 const retention=retentionFixture();try{
  retention.reserve(retention.proposal());const before=rows(retention.db);const schema=graph(retention.db);
  expect(()=>asSchema24(retention.db)).toThrow('retention data');expect(rows(retention.db)).toEqual(before);expect(graph(retention.db)).toEqual(schema);
  expect(retention.db.prepare('PRAGMA user_version').get()?.user_version).toBe(METADATA_SCHEMA_VERSION);
 }finally{retention.db.close();}
});
