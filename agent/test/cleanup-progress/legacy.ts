import { asSchema19 } from '../cleanup-receipts/legacy.js';
import type { DatabaseSync } from 'node:sqlite';
/** Synthetic fixture downgrade only; retained native progress must never be discarded. */
export function asSchema18(db:DatabaseSync):void{
 if([20,21,22,23,24,25,26].includes(Number(db.prepare('PRAGMA user_version').get()?.user_version)))asSchema19(db);
 if(db.prepare('PRAGMA user_version').get()?.user_version!==19||db.prepare('SELECT COUNT(*) AS n FROM output_cleanup_progress').get()?.n!==0)throw Error('Expected empty schema19 cleanup progress');
 for(const name of ['cleanup_progress_initial','cleanup_progress_update','cleanup_progress_retained'])db.exec('DROP TRIGGER '+name);
 db.exec('DROP TABLE output_cleanup_progress; PRAGMA user_version=18;');
}
