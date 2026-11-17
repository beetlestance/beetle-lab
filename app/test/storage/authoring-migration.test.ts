import {expect,it} from 'vitest';
import type {DatabaseSync} from 'node:sqlite';
import {initialize as prior023} from '../backend-settlement/prior023.js';
import {migration024} from '../../src/adapters/outbound/sqlite/migration024.js';
import {migrate025} from '../../src/adapters/outbound/sqlite/migration025.js';
import {migration026} from '../../src/adapters/outbound/sqlite/migration026.js';
import {migration027} from '../../src/adapters/outbound/sqlite/migration027.js';
import {migration028} from '../../src/adapters/outbound/sqlite/migration028.js';
import {migration029} from '../../src/adapters/outbound/sqlite/migration029.js';
import {migration030} from '../../src/adapters/outbound/sqlite/migration030.js';
import {migration031} from '../../src/adapters/outbound/sqlite/migration031.js';
import {registerBackendSettlement} from '../../src/adapters/outbound/sqlite/backend-settlement-guard/index.js';
import {registerRetentionAccounting} from '../../src/adapters/outbound/sqlite/retention-accounting-guard/index.js';
import {transaction} from '../../src/adapters/outbound/sqlite/transaction.js';
import {graph,rows} from './clock-reason/fixtures.js';
import {seedFoundation,enqueue} from './execution-foundation-fixtures.js';
function prior030(){
 const db=prior023(':memory:');registerBackendSettlement(db);registerRetentionAccounting(db);
 transaction(db,()=>db.exec(migration024));transaction(db,()=>migrate025(db));
 for(const sql of [migration026,migration027,migration028,migration029,migration030])transaction(db,()=>db.exec(sql));
 const store=seedFoundation(db);const queued=enqueue(db,store);return {db,run:queued.run};
}
const added:Record<string,string[]>={suites:['description'],suite_revisions:['saved_at','message','saved_by']};
function originalRows(db:DatabaseSync){
 return rows(db).filter(table=>!['run_notes','history_note_grams'].includes(table.name)).map(table=>{
  const strip=added[table.name];if(strip===undefined)return table;
  return {...table,rows:table.rows.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>!strip.includes(key))))};
 });
}
it('upgrades populated schema030 leaving every existing suite and revision unstamped',()=>{
 const {db}=prior030();try{
  const before=rows(db);expect(db.prepare('SELECT count(*) AS n FROM suite_revisions').get()?.n).toBe(1);
  transaction(db,()=>db.exec(migration031));
  expect(originalRows(db)).toEqual(before);
  expect(db.prepare('SELECT description FROM suites').all()).toEqual([{description:null}]);
  expect(db.prepare('SELECT saved_at,message,saved_by FROM suite_revisions').all()).toEqual([{saved_at:null,message:null,saved_by:null}]);
  expect(db.prepare('SELECT count(*) AS n FROM run_notes').get()?.n).toBe(0);
  expect(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='index' AND name='run_events_runtime'").get()).toBeDefined();
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(31);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{db.close();}
});
it('guards stamped revision metadata and versioned, retained run notes with their postings',()=>{
 const {db,run}=prior030();try{
  transaction(db,()=>db.exec(migration031));
  expect(()=>db.exec("UPDATE suite_revisions SET saved_at='2026-11-10T00:00:00.000Z'")).toThrow();
  expect(()=>db.prepare('INSERT INTO run_notes VALUES(?,?,?,2,?)').run(run.id,run.scope.organizationId,run.scope.workspaceId,'x')).toThrow('version 1');
  db.prepare('INSERT INTO run_notes VALUES(?,?,?,1,?)').run(run.id,run.scope.organizationId,run.scope.workspaceId,'Warm cache');
  const terms=()=>db.prepare('SELECT term FROM history_note_grams ORDER BY term').all().map(row=>row.term);
  expect(terms()).toContain('cac');
  expect(()=>db.prepare('UPDATE run_notes SET note=?,version=3').run('Cold')).toThrow('run note version');
  db.prepare('UPDATE run_notes SET note=?,version=2').run('Cold start');expect(terms()).not.toContain('cac');expect(terms()).toContain('col');
  db.prepare('UPDATE run_notes SET note=NULL,version=3').run();expect(terms()).toEqual([]);
  expect(()=>db.exec('DELETE FROM run_notes')).toThrow('retained run note');
  expect(()=>db.prepare('INSERT INTO run_notes VALUES(?,?,?,1,NULL)').run('00000000-0000-4000-8000-0000000000ff',
   run.scope.organizationId,run.scope.workspaceId)).toThrow();
 }finally{db.close();}
});
it('rolls a late collision back to the exact populated schema030',()=>{
 const {db}=prior030();try{
  db.exec('CREATE TABLE history_note_grams(canary TEXT)');
  const before=rows(db);const schema=graph(db);
  expect(()=>transaction(db,()=>db.exec(migration031))).toThrow();
  expect(rows(db)).toEqual(before);expect(graph(db)).toEqual(schema);
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(30);
 }finally{db.close();}
});
