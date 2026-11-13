import type { DatabaseSync } from 'node:sqlite';
/** Synthetic fixture only; never discard an actual retained receipt. */
export function asSchema19(db:DatabaseSync):void{
 if(db.prepare('PRAGMA user_version').get()?.user_version!==20||db.prepare('SELECT COUNT(*) AS n FROM output_cleanup_receipts').get()?.n!==0)throw Error('Expected empty schema20 cleanup receipts');
 for(const name of ['cleanup_receipt_initial','cleanup_receipt_immutable','cleanup_receipt_retained'])db.exec('DROP TRIGGER '+name);
 db.exec('DROP TABLE output_cleanup_receipts; PRAGMA user_version=19;');
}
