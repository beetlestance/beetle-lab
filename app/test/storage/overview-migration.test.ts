import {migration002} from '../../src/adapters/outbound/sqlite/migration002.js';
import {migrate003} from '../../src/adapters/outbound/sqlite/migration003.js';
import {migration004} from '../../src/adapters/outbound/sqlite/migration004.js';
import {migration005} from '../../src/adapters/outbound/sqlite/migration005.js';
import {migration006} from '../../src/adapters/outbound/sqlite/migration006.js';
import {migration007} from '../../src/adapters/outbound/sqlite/migration007.js';
import {migrate008} from '../../src/adapters/outbound/sqlite/migration008.js';
import {migration009} from '../../src/adapters/outbound/sqlite/migration009.js';
import {migration010} from '../../src/adapters/outbound/sqlite/migration010.js';
import {migration011} from '../../src/adapters/outbound/sqlite/migration011.js';
import {migration012} from '../../src/adapters/outbound/sqlite/migration012.js';
import {migration013} from '../../src/adapters/outbound/sqlite/migration013.js';
import {migration014} from '../../src/adapters/outbound/sqlite/migration014.js';
import {migration015} from '../../src/adapters/outbound/sqlite/migration015.js';
import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {initialize,migration001,transaction} from '../../src/adapters/outbound/sqlite/schema.js';
import {registerAbsenceValidation} from '../../src/adapters/outbound/sqlite/output-absence/values.js';
import {Store} from '../../src/adapters/outbound/sqlite/store.js';
import {command,settingsFixture,observation,requestId,uuid} from './fixture.js';
let root='';afterEach(async()=>{if(root)await rm(root,{recursive:true,force:true});});
async function prior():Promise<{path:string;db:DatabaseSync}>{
 root=await mkdtemp(join(tmpdir(),'beetle-overview-migration-'));const path=join(root,'metadata.sqlite');
 const db=new DatabaseSync(path,{enableForeignKeyConstraints:true});registerAbsenceValidation(db);db.exec(migration001);
 const steps=[()=>db.exec(migration002),()=>migrate003(db),()=>db.exec(migration004),()=>db.exec(migration005),()=>db.exec(migration006),()=>db.exec(migration007),()=>migrate008(db),()=>db.exec(migration009),()=>db.exec(migration010),()=>db.exec(migration011),()=>db.exec(migration012),()=>db.exec(migration013),()=>db.exec(migration014),()=>db.exec(migration015)];
 for(const step of steps)transaction(db,step);
 expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(15);return {path,db};
}
it('upgrades genuine source migration15 to16, preserves all tables/data and selects bounded-list indexes',async()=>{
 const {path,db}=await prior();const store=new Store(db,{installation:settingsFixture().chain.installation,runtime:observation()});
 store.execute({kind:'namespace',command:command({kind:'createOrganization',id:uuid(1),request:{scope:{kind:'installation'},requestId:requestId(),name:'Synthetic',slug:'synthetic'}})});
 store.execute({kind:'namespace',command:command({kind:'createWorkspace',id:uuid(2),rootFolderId:uuid(3),request:{scope:{kind:'organization',organizationId:uuid(1)},requestId:requestId(),name:'Synthetic'}})});
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>String(row.name));
 const before=tables.map(table=>db.prepare(`SELECT * FROM "${table}"`).all());db.close();const upgraded=initialize(path);
 try{
  expect(upgraded.prepare('PRAGMA user_version').get()?.user_version).toBe(20);
  expect(tables.map(table=>upgraded.prepare(`SELECT * FROM "${table}"`).all())).toEqual(before);expect(upgraded.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  const plan=(extra:string)=>upgraded.prepare(`EXPLAIN QUERY PLAN SELECT id,suite_id,revision_id,requested_at,state,outcome FROM runs WHERE organization_id=? AND workspace_id=? ${extra} ORDER BY requested_at DESC,id DESC LIMIT 20`).all(uuid(1),uuid(2)).map(row=>row.detail).join(' ');
  expect(plan('')).toContain('runs_overview_recent');expect(plan("AND state='active'")).toContain('runs_overview_active');
  expect(plan('')).not.toContain('TEMP B-TREE');expect(plan("AND state='active'")).not.toContain('TEMP B-TREE');
 }finally{upgraded.close();}
});
it('rolls back an index-name collision at schema15 without changing prior data',async()=>{
 const {path,db}=await prior();db.exec('CREATE INDEX runs_overview_active ON runs(id)');db.close();expect(()=>initialize(path)).toThrow();
 const priorDb=new DatabaseSync(path);expect(priorDb.prepare('PRAGMA user_version').get()?.user_version).toBe(15);
 expect(priorDb.prepare("SELECT name FROM sqlite_master WHERE name='runs_overview_recent'").get()).toBeUndefined();
 priorDb.exec('DROP INDEX runs_overview_active');priorDb.close();const upgraded=initialize(path);expect(upgraded.prepare('PRAGMA user_version').get()?.user_version).toBe(20);upgraded.close();
});
