import type {DatabaseSync} from 'node:sqlite';
/** Synthetic prefix only; never erase an observed runtime association. */
export function asSchema20(db:DatabaseSync):void{
 const version=db.prepare('PRAGMA user_version').get()?.user_version;if(version===20)return;
 if(version!==21||db.prepare('SELECT 1 FROM runtime_cleanup_associations LIMIT 1').get())throw Error('Cannot project retained runtime association');
 for(const name of ['initial','immutable','retained'])db.exec(`DROP TRIGGER runtime_association_${name}`);
 db.exec('DROP TABLE runtime_cleanup_associations;PRAGMA user_version=20');
}
