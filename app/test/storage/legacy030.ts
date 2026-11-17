import type {DatabaseSync} from 'node:sqlite';
import {transaction} from '../../src/adapters/outbound/sqlite/transaction.js';
import {migration033} from '../../src/adapters/outbound/sqlite/migration033.js';
const version=(db:DatabaseSync)=>Number(db.prepare('PRAGMA user_version').get()?.user_version);
/**
 * Test-only projection of the run-pin step (and its reserved 031/032 slots) around an older projection.
 * A real pin is never rewound; a refused older projection restores the exact empty pin owner.
 */
export function withoutPins(db:DatabaseSync,project:()=>void):void{
 if(version(db)!==33)return project();
 if(db.prepare('SELECT 1 FROM run_pins LIMIT 1').get())throw Error('Cannot project fixture with run pins');
 transaction(db,()=>db.exec('DROP TRIGGER run_pin_removal_guard;DROP TABLE run_pins;PRAGMA user_version=30'));
 try{project();}catch(error){
  if(version(db)===30)transaction(db,()=>db.exec(migration033));
  throw error;
 }
}
