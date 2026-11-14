import type {DatabaseSync} from 'node:sqlite';
import {migration026} from '../../src/adapters/outbound/sqlite/migration026.js';
import {transaction} from '../../src/adapters/outbound/sqlite/transaction.js';
/** Test-only empty-new-owner projection. Never drops a retained deletion identity or charge. */
export function asSchema25(db:DatabaseSync):void{
 const version=db.prepare('PRAGMA user_version').get()?.user_version;if(version===25)return;
 if(version!==26||db.prepare('SELECT 1 FROM namespace_deletions LIMIT 1').get())throw Error('Cannot project fixture with namespace deletion data');
 transaction(db,()=>{
  for(const match of migration026.matchAll(/CREATE TRIGGER ([a-z_]+)/g))db.exec(`DROP TRIGGER ${match[1]}`);
  db.exec('DROP TABLE namespace_deletions;DROP INDEX settings_namespace;DROP INDEX backend_retired_scope;PRAGMA user_version=25');
 });
}
