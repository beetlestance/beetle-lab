import { expect,it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { fixture } from './fixture.js';
import { asSchema23 } from './legacy023.js';
import { rows,graph } from '../storage/clock-reason/fixtures.js';
import { migration024 } from '../../src/adapters/outbound/sqlite/migration024.js';
import { initialize,transaction,METADATA_SCHEMA_VERSION } from '../../src/adapters/outbound/sqlite/schema.js';
import { storageFixture } from '../storage/fixture.js';
const storage=storageFixture();
it('adds24 without altering populated prior rows or charges and reopens the same permanent identity',()=>{
 const f=fixture();asSchema23(f.db);const before=rows(f.db);transaction(f.db,()=>f.db.exec(migration024));
 expect(rows(f.db).filter(row=>!['backend_retired_runs','backend_replay_storage'].includes(row.name))).toEqual(before);
 expect(f.db.prepare('SELECT * FROM backend_replay_storage').get()).toEqual({id:1,original_count:0,charged_bytes:0});
 const path=storage.path();f.db.prepare('VACUUM INTO ?').run(path);let db=initialize(path);db.close();db=initialize(path);
 try{expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(METADATA_SCHEMA_VERSION);expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);}finally{db.close();}
});
it('rolls back a late migration collision to exact23 schema and rows',()=>{
 const f=fixture();asSchema23(f.db);f.db.exec('CREATE TABLE backend_replay_storage(collision TEXT)');const before=rows(f.db);const schema=graph(f.db);
 expect(()=>transaction(f.db,()=>f.db.exec(migration024))).toThrow();expect(rows(f.db)).toEqual(before);expect(graph(f.db)).toEqual(schema);
 expect(f.db.prepare('PRAGMA user_version').get()?.user_version).toBe(23);
});
it('refuses to rewind committed settlement or newer schemas',()=>{
 const f=fixture();f.settle();expect(()=>asSchema23(f.db)).toThrow('settlement data');
 const path=storage.path();const db=new DatabaseSync(path);db.exec(`PRAGMA user_version=${METADATA_SCHEMA_VERSION+1};CREATE TABLE canary(v);INSERT INTO canary VALUES(7)`);db.close();
 expect(()=>initialize(path)).toThrow('schema_newer');const raw=new DatabaseSync(path,{readOnly:true});try{expect(raw.prepare('SELECT v FROM canary').get()?.v).toBe(7);}finally{raw.close();}
});
