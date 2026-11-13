import { expect,it } from 'vitest';
import { prior019,rows,graph } from '../clock-reason/fixtures.js';
import { transaction } from '../../../src/adapters/outbound/sqlite/schema.js';
import { migrate020 } from '../../../src/adapters/outbound/sqlite/migration020.js';
import { migration021 } from '../../../src/adapters/outbound/sqlite/migration021.js';
function previous(){const f=prior019(':memory:');transaction(f.db,()=>migrate020(f.db));return f;}
it('adds actual schema21 without inventing reservations or altering any schema20 row/guard',()=>{
 const f=previous();try{const before=rows(f.db);const old=graph(f.db);transaction(f.db,()=>f.db.exec(migration021));
  for(const row of before)expect(rows(f.db).find(value=>value.name===row.name)).toEqual(row);
  for(const item of old)expect(graph(f.db).find(value=>value.name===item.name&&value.type===item.type)).toEqual(item);
  expect(f.db.prepare('SELECT count(*) n FROM backend_cleanup_controls').get()?.n).toBe(0);expect(f.db.prepare('PRAGMA user_version').get()?.user_version).toBe(21);
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{f.db.close();}
});
it('rolls late schema creation failure back without partial ledger/guards/version changes',()=>{
 const f=previous();try{f.db.exec('CREATE TABLE backend_cleanup_controls(collision INTEGER)');const old=graph(f.db);const before=rows(f.db);
  expect(()=>transaction(f.db,()=>f.db.exec(migration021))).toThrow();expect(graph(f.db)).toEqual(old);expect(rows(f.db)).toEqual(before);expect(f.db.prepare('PRAGMA user_version').get()?.user_version).toBe(20);
 }finally{f.db.close();}
});
