import {asSchema22} from './legacy022.js';
import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../../../src/adapters/outbound/sqlite/schema.js';
/** Synthetic historical fixtures only. Never discard a committed ACK to rewind. */
export function asSchema21(db:DatabaseSync):void{
 if(Number(db.prepare('PRAGMA user_version').get()?.user_version)>=23)asSchema22(db);
 const version=db.prepare('PRAGMA user_version').get()?.user_version;if(version===21)return;
 if(version!==22||db.prepare('SELECT 1 FROM backend_output_cleanup_acks LIMIT 1').get())throw Error('Cannot project fixture with ACK data');
 transaction(db,()=>{for(const name of ['insert','immutable','retained'])db.exec(`DROP TRIGGER cleanup_ack_${name}`);
  db.exec('DROP TABLE backend_output_cleanup_acks;PRAGMA user_version=21');});
}
