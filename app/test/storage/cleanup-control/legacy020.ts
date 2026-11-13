import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../../../src/adapters/outbound/sqlite/schema.js';
/** Synthetic predecessor projection for task-owned fixtures, never production recovery. */
export function asSchema20(db:DatabaseSync):void{
 const version=db.prepare('PRAGMA user_version').get()?.user_version;
 if(version===20)return;
 if(version!==21)throw Error('Expected policy1 fixture');
 transaction(db,()=>{
  const rows=db.prepare('SELECT reserved_bytes FROM backend_cleanup_controls LIMIT 65').all();if(rows.length>64)throw Error('Fixture bound');
  const charge=rows.reduce((sum,row)=>sum+Number(row.reserved_bytes),0);
  for(const name of ['insert','charge','immutable','retained','delivery','deletion','file','file_insert'])db.exec(`DROP TRIGGER cleanup_control_${name}`);
  db.prepare('UPDATE installation_storage_usage SET charged_bytes=charged_bytes-? WHERE id=1').run(charge);
  db.exec('DROP TABLE backend_cleanup_controls;PRAGMA user_version=20');
 });
}
