import {expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initialize as prior023} from '../backend-settlement/prior023.js';
import {migration024} from '../../src/adapters/outbound/sqlite/migration024.js';
import {migrate025} from '../../src/adapters/outbound/sqlite/migration025.js';
import {migration026} from '../../src/adapters/outbound/sqlite/migration026.js';
import {migration027} from '../../src/adapters/outbound/sqlite/migration027.js';
import {migration028} from '../../src/adapters/outbound/sqlite/migration028.js';
import {migration029} from '../../src/adapters/outbound/sqlite/migration029.js';
import {migration030} from '../../src/adapters/outbound/sqlite/migration030.js';
import {migration033} from '../../src/adapters/outbound/sqlite/migration033.js';
import {initialize,METADATA_SCHEMA_VERSION} from '../../src/adapters/outbound/sqlite/schema.js';
import {registerBackendSettlement} from '../../src/adapters/outbound/sqlite/backend-settlement-guard/index.js';
import {registerRetentionAccounting} from '../../src/adapters/outbound/sqlite/retention-accounting-guard/index.js';
import {transaction} from '../../src/adapters/outbound/sqlite/transaction.js';
import {graph,rows} from './clock-reason/fixtures.js';
import {seedFoundation,enqueue} from './execution-foundation-fixtures.js';
/** Shipped schema030 with a real enqueued run, then the cancellation shape RunCancellations writes for an unsent run. */
function prior030(){
 const db=prior023(':memory:');registerBackendSettlement(db);registerRetentionAccounting(db);
 transaction(db,()=>db.exec(migration024));transaction(db,()=>migrate025(db));
 for(const sql of [migration026,migration027,migration028,migration029,migration030])transaction(db,()=>db.exec(sql));
 const store=seedFoundation(db);enqueue(db,store);
 transaction(db,()=>{
  const run=db.prepare('SELECT id,active_attempt_id,version FROM runs LIMIT 1').get()!;
  db.prepare('DELETE FROM dispatch_outbox WHERE attempt_id=?').run(run.active_attempt_id!);
  db.prepare("UPDATE runs SET cancellation_requested=1,state='cancelled',outcome='inconclusive',reason='cancelled',version=? WHERE id=?").run(Number(run.version)+1,run.id!);
 });
 return db;
}
function upgrade(db:ReturnType<typeof prior030>){
 for(const sql of ['PRAGMA user_version=31;','PRAGMA user_version=32;',migration033])transaction(db,()=>db.exec(sql));
}
it('upgrades populated schema030 with only an empty pin owner and its guards',()=>{
 const db=prior030();try{
  const before=rows(db);upgrade(db);
  expect(rows(db).filter(table=>table.name!=='run_pins')).toEqual(before);
  expect(db.prepare('SELECT count(*) n FROM run_pins').get()?.n).toBe(0);
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(33);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  const run=db.prepare('SELECT id,organization_id,workspace_id FROM runs LIMIT 1').get()!;
  const insert=db.prepare('INSERT INTO run_pins(run_id,organization_id,workspace_id,pinned_at,request_id) VALUES(?,?,?,?,?)');
  insert.run(run.id!,run.organization_id!,run.workspace_id!,'2026-11-14T12:00:00.000Z','00000000-0000-4000-8000-000000009999');
  expect(db.prepare('SELECT run_id FROM run_pins').all()).toEqual([{run_id:run.id}]);
  expect(()=>insert.run(run.id!,run.organization_id!,'00000000-0000-4000-8000-000000000999','2026-11-14T12:00:00.000Z','00000000-0000-4000-8000-000000009998')).toThrow();
 }finally{db.close();}
});
it('rolls a late name collision back to the exact populated predecessor',()=>{
 const db=prior030();try{
  transaction(db,()=>db.exec('PRAGMA user_version=32;'));
  db.exec('CREATE TRIGGER run_pin_removal_guard BEFORE INSERT ON output_deletion_intents BEGIN SELECT 1;END');
  const before=rows(db);const schema=graph(db);
  expect(()=>transaction(db,()=>db.exec(migration033))).toThrow();
  expect(rows(db)).toEqual(before);expect(graph(db)).toEqual(schema);
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(32);
 }finally{db.close();}
});
it('opens a populated schema030 file through the serving migration path',()=>{
 const directory=mkdtempSync(join(tmpdir(),'run-pins-'));const path=join(directory,'metadata.sqlite');
 try{
  const source=prior030();const before=rows(source);try{source.prepare('VACUUM INTO ?').run(path);}finally{source.close();}
  const db=initialize(path);try{
   expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(METADATA_SCHEMA_VERSION);
   expect(rows(db).filter(table=>table.name!=='run_pins')).toEqual(before);
  }finally{db.close();}
 }finally{rmSync(directory,{recursive:true,force:true});}
});
