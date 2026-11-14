import {asSchema23} from '../../backend-settlement/legacy023.js';
import type {DatabaseSync} from 'node:sqlite';
import {transaction} from '../../../src/adapters/outbound/sqlite/schema.js';
/** Synthetic prefix fixture; preserve every committed row and guard. */
export function asSchema22(db:DatabaseSync):void{
 if([24,25,26].includes(Number(db.prepare('PRAGMA user_version').get()?.user_version)))asSchema23(db);
 const version=db.prepare('PRAGMA user_version').get()?.user_version;if(version===22)return;
 if(version!==23)throw Error('Cannot project fixture to schema22');
 transaction(db,()=>{db.exec('DROP INDEX output_deletion_retirable;PRAGMA user_version=22');});
}
