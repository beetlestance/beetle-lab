import { it,expect } from 'vitest';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture as sourceFixture } from '../backend-settlement/fixture.js';
import { rows,graph } from '../storage/clock-reason/fixtures.js';
import { initialize,transaction,METADATA_SCHEMA_VERSION } from '../../src/adapters/outbound/sqlite/schema.js';
import { migrate025 } from '../../src/adapters/outbound/sqlite/migration025.js';
import { reserveRetentionSnapshot } from '../../src/adapters/outbound/sqlite/retention-accounting/index.js';
import { asSchema24 } from './legacy024.js';
import { fixture,now,usage } from './fixture.js';
it('upgrades populated actual24 rows without backfill, credits or old schema changes',()=>{
 const f=sourceFixture();asSchema24(f.db);const before=rows(f.db);const oldTables=graph(f.db).filter(row=>row.type==='table');
 transaction(f.db,()=>migrate025(f.db));
 expect(rows(f.db).filter(row=>!row.name.startsWith('retention_'))).toEqual(before);
 expect(graph(f.db).filter(row=>row.type==='table'&&!String(row.name).startsWith('retention_'))).toEqual(oldTables);
 expect(f.db.prepare('SELECT count(*) n FROM retention_workspace_epochs').get()?.n).toBe(0);
 expect(f.db.prepare('SELECT * FROM retention_storage').get()).toEqual({id:1,epoch_count:0,snapshot_count:0,charged_bytes:0,clock_ms:0});
 expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
it('rolls a late migration collision back to exact24 rows, schema and charge',()=>{
 const f=sourceFixture();asSchema24(f.db);
 f.db.exec('CREATE TRIGGER retention_run_insert AFTER INSERT ON runs BEGIN SELECT 1;END');const before=rows(f.db);const schema=graph(f.db);
 expect(()=>transaction(f.db,()=>migrate025(f.db))).toThrow();expect(rows(f.db)).toEqual(before);expect(graph(f.db)).toEqual(schema);
 expect(f.db.prepare('PRAGMA user_version').get()?.user_version).toBe(24);
});
it('reopens the same funded identity/counter once and refuses synthetic rewind of charged data',()=>{
 const f=fixture();const proposal=f.proposal();const stored=f.reserve(proposal);const before=usage(f.db);
 expect(()=>asSchema24(f.db)).toThrow('retention data');
 const root=mkdtempSync(join(tmpdir(),'beetle-retention-reopen-'));const path=join(root,'metadata.sqlite');f.db.prepare('VACUUM INTO ?').run(path);f.db.close();
 const db=initialize(path);try{
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(METADATA_SCHEMA_VERSION);
  expect(transaction(db,()=>reserveRetentionSnapshot(db,proposal,now))).toEqual(stored);expect(usage(db)).toBe(before);
  expect(db.prepare('SELECT count(*) n FROM retention_workspace_epochs').get()?.n).toBe(1);expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
