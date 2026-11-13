import {expect,it} from 'vitest';
import {prior019,rows,graph} from '../../storage/clock-reason/fixtures.js';
import {transaction} from '../../../src/adapters/outbound/sqlite/schema.js';
import {migrate020} from '../../../src/adapters/outbound/sqlite/migration020.js';
import {migration021} from '../../../src/adapters/outbound/sqlite/migration021.js';
import {migration022} from '../../../src/adapters/outbound/sqlite/migration022.js';
import {migration023} from '../../../src/adapters/outbound/sqlite/migration023.js';
function previous(){const f=prior019(':memory:');transaction(f.db,()=>{migrate020(f.db);f.db.exec(migration021);f.db.exec(migration022);});return f;}
it('adds only the bounded retirement index to the actual schema22 prefix',()=>{
 const f=previous();try{const before=rows(f.db);const schema=graph(f.db);transaction(f.db,()=>f.db.exec(migration023));
  expect(rows(f.db)).toEqual(before);for(const item of schema)expect(graph(f.db).find(row=>row.name===item.name&&row.type===item.type)).toEqual(item);
  expect(f.db.prepare('PRAGMA user_version').get()?.user_version).toBe(23);expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{f.db.close();}
});
it('rolls back an index collision without row, schema or version changes',()=>{
 const f=previous();try{f.db.exec('CREATE INDEX output_deletion_retirable ON runs(id)');const before=rows(f.db);const schema=graph(f.db);
  expect(()=>transaction(f.db,()=>f.db.exec(migration023))).toThrow();expect(rows(f.db)).toEqual(before);expect(graph(f.db)).toEqual(schema);expect(f.db.prepare('PRAGMA user_version').get()?.user_version).toBe(22);
 }finally{f.db.close();}
});
