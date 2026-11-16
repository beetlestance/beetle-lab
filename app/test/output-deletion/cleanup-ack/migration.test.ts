import { expect,it } from 'vitest';
import { prior019,rows,graph } from '../../storage/clock-reason/fixtures.js';
import { transaction } from '../../../src/adapters/outbound/sqlite/schema.js';
import { migrate020 } from '../../../src/adapters/outbound/sqlite/migration020.js';
import { migration021 } from '../../../src/adapters/outbound/sqlite/migration021.js';
import { migration022 } from '../../../src/adapters/outbound/sqlite/migration022.js';
import { registerCleanupAckValidation } from '../../../src/adapters/outbound/sqlite/cleanup-ack-guard/index.js';
import { fixture } from './fixture.js';
import { asSchema21 } from './legacy021.js';
function previous(){const f=prior019(':memory:');transaction(f.db,()=>migrate020(f.db));transaction(f.db,()=>f.db.exec(migration021));registerCleanupAckValidation(f.db);return f;}
it('preserves every actual schema21 table/guard/charge without inventing an ACK',()=>{
 const f=previous();try{const before=rows(f.db);const schema=graph(f.db);transaction(f.db,()=>f.db.exec(migration022));
  for(const item of before)expect(rows(f.db).find(row=>row.name===item.name)).toEqual(item);
  for(const item of schema)expect(graph(f.db).find(row=>row.name===item.name&&row.type===item.type)).toEqual(item);
  expect(f.db.prepare('SELECT count(*) n FROM backend_output_cleanup_acks').get()?.n).toBe(0);expect(f.db.prepare('PRAGMA user_version').get()?.user_version).toBe(22);expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{f.db.close();}
});
it('rolls back a late trigger collision with unchanged schema/rows/version',()=>{
 const f=previous();try{f.db.exec('CREATE TRIGGER cleanup_ack_retained BEFORE UPDATE ON runs BEGIN SELECT 1;END');const before=rows(f.db);const schema=graph(f.db);
  expect(()=>transaction(f.db,()=>f.db.exec(migration022))).toThrow();expect(rows(f.db)).toEqual(before);expect(graph(f.db)).toEqual(schema);expect(f.db.prepare('PRAGMA user_version').get()?.user_version).toBe(21);
 }finally{f.db.close();}
});
it('synthetic historical projection refuses to erase an actual committed ACK',()=>{
 const f=fixture();f.record();expect(()=>asSchema21(f.db)).toThrow('ACK data');expect(f.read()).toMatchObject({kind:'stored'});
});
