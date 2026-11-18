import {asSchema27} from './legacy027.js';
import type {DatabaseSync} from 'node:sqlite';
import {migration026} from '../../src/adapters/outbound/sqlite/migration026.js';
import {transaction} from '../../src/adapters/outbound/sqlite/transaction.js';
/** Test-only empty-new-owner projection. Never drops a retained deletion identity or charge. */
export function asSchema25(db:DatabaseSync):void{
 const initial=Number(db.prepare('PRAGMA user_version').get()?.user_version);if(initial===25)return;
 if(![26,27,28,29,30,31,32,33,34,35,36].includes(initial))throw Error('Cannot project fixture with namespace deletion data');
 if(db.prepare('SELECT 1 FROM namespace_deletions LIMIT 1').get())throw Error('Cannot project fixture with namespace deletion data');
 if(initial>=28)asSchema27(db);
 if(db.prepare('PRAGMA user_version').get()?.user_version===27){
  transaction(db,()=>db.exec('DROP INDEX runs_org_overview_recent;DROP INDEX runs_org_overview_active;PRAGMA user_version=26'));
 }
 const version=db.prepare('PRAGMA user_version').get()?.user_version;
 if(version!==26)throw Error('Cannot project fixture with namespace deletion data');
 transaction(db,()=>{
  for(const match of migration026.matchAll(/CREATE TRIGGER ([a-z_]+)/g))db.exec(`DROP TRIGGER ${match[1]}`);
  db.exec('DROP TABLE namespace_deletions;DROP INDEX settings_namespace;DROP INDEX backend_retired_scope;PRAGMA user_version=25');
 });
}
