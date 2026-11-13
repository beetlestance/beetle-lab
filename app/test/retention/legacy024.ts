import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../../src/adapters/outbound/sqlite/transaction.js';
/** Synthetic empty-retention projection only; charged rows/epochs can never be rewound. */
export function asSchema24(db:DatabaseSync):void{
 const version=db.prepare('PRAGMA user_version').get()?.user_version;if(version===24)return;
 if(version!==25||db.prepare('SELECT 1 FROM retention_workspace_epochs LIMIT 1').get()||db.prepare('SELECT 1 FROM retention_snapshots LIMIT 1').get()
  ||db.prepare('SELECT 1 FROM retention_storage WHERE epoch_count<>0 OR snapshot_count<>0 OR charged_bytes<>0 OR clock_ms<>0').get())throw Error('Cannot project fixture with retention data');
 const triggers=db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'retention_%'").all();
 transaction(db,()=>{
  for(const row of triggers){if(typeof row.name!=='string'||!/^[a-z_]+$/.test(row.name))throw Error('Unexpected synthetic trigger');db.exec(`DROP TRIGGER ${row.name}`);}
  db.exec('DROP TABLE retention_progress;DROP TABLE retention_snapshots;DROP TABLE retention_workspace_epochs;DROP TABLE retention_storage;PRAGMA user_version=24');
 });
}
