import { asSchema18 } from '../cleanup-progress/legacy.js';
import type { DatabaseSync } from 'node:sqlite';
/** Synthetic fixture only; never discard a retained native plan. */
export function asSchema17(db:DatabaseSync):void{
 if(db.prepare('PRAGMA user_version').get()?.user_version===19||db.prepare('PRAGMA user_version').get()?.user_version===20)asSchema18(db);
 if(db.prepare('PRAGMA user_version').get()?.user_version!==18||db.prepare('SELECT COUNT(*) AS n FROM output_cleanup_plans').get()?.n!==0)throw Error('Expected empty schema18 cleanup plans');
 for(const name of ['cleanup_plan_initial','cleanup_plan_immutable','cleanup_plan_retained'])db.exec('DROP TRIGGER '+name);
 db.exec('DROP TABLE output_cleanup_plans; PRAGMA user_version=17;');
}
