import {expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {initialize,METADATA_SCHEMA_VERSION} from '../../src/adapters/outbound/sqlite/schema.js';
import {settingsFixture} from '../storage/fixture.js';
import {prior14} from './prior-schema.js';
it('rolls a late metadata015 collision back to actual schema14 without losing existing data, then upgrades and reopens',async()=>{
 const root=await mkdtemp(join(tmpdir(),'beetle-export-migration-'));const path=join(root,'metadata.sqlite');
 try{
  let db=prior14(path);const fixture=settingsFixture();const record=fixture.chain.installation;
  db.prepare("INSERT INTO settings(scope_key,id,kind,organization_id,workspace_id,version,value_json) VALUES('installation',?,'installation',NULL,NULL,1,?)")
   .run(record.id,JSON.stringify(record.values));const before=db.prepare('SELECT * FROM settings').all();
  db.exec("CREATE TABLE export_artifacts(canary TEXT);INSERT INTO export_artifacts VALUES('retained');");db.close();
  expect(()=>initialize(path)).toThrow();db=new DatabaseSync(path);
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(14);expect(db.prepare('SELECT * FROM settings').all()).toEqual(before);
  expect(db.prepare("SELECT name FROM sqlite_schema WHERE name IN ('execution_orders','export_jobs','export_originals')").all()).toEqual([]);
  expect(db.prepare('SELECT * FROM export_artifacts').all()).toEqual([{canary:'retained'}]);db.exec('DROP TABLE export_artifacts');db.close();
  db=initialize(path);expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(METADATA_SCHEMA_VERSION);expect(db.prepare('SELECT * FROM settings').all()).toEqual(before);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);db.close();
  db=initialize(path);expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(METADATA_SCHEMA_VERSION);expect(db.prepare('SELECT * FROM settings').all()).toEqual(before);db.close();
 }finally{await rm(root,{recursive:true,force:true});}
});
