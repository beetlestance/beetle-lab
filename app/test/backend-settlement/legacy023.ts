import { asSchema24 } from '../retention/legacy024.js';
import type { DatabaseSync } from 'node:sqlite';
import { initialize as prior023 } from './prior023.js';
import { transaction } from '../../src/adapters/outbound/sqlite/schema.js';
/** Synthetic predecessor projection only; never discard a retired identity or replay debt. */
export function asSchema23(db:DatabaseSync):void{
 const version=db.prepare('PRAGMA user_version').get()?.user_version;if(version===23)return;
 if(![24,25,26,27].includes(Number(version))||db.prepare('SELECT 1 FROM backend_retired_runs LIMIT 1').get()
  ||db.prepare('SELECT 1 FROM backend_replay_storage WHERE original_count<>0 OR charged_bytes<>0').get())throw Error('Cannot project fixture with settlement data');
 asSchema24(db);const old=prior023(':memory:');
 try{
  const previous=old.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all();
  const current=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all();
  const wanted=new Map(previous.map(row=>[row.name,row.sql]));
  transaction(db,()=>{
   for(const row of current)if(wanted.get(row.name)!==row.sql)db.exec(`DROP TRIGGER ${row.name}`);
   for(const row of previous)if(!current.some(value=>value.name===row.name&&value.sql===row.sql))db.exec(String(row.sql));
   db.exec('DROP TABLE backend_retired_runs;DROP TABLE backend_replay_storage;PRAGMA user_version=23');
  });
 }finally{old.close();}
}
