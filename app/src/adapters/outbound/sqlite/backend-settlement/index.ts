import { captureSettlementWrite,settlementKey } from './wire.js';
import type { DatabaseSync } from 'node:sqlite';
import type { Run } from '@beetle/contracts/api';
import type { RunKey } from '../../../../ports/runs.js';
import type { BackendSettlementWrite } from '../../../../ports/output-settlement-metadata.js';
import type { OutputDeletionKey } from '../../../../ports/output-deletion-metadata.js';
import { assertSettlementConnection,commitBackendSettlement,poisonSettlementConnection } from '../backend-settlement-guard/index.js';
import { StorageError } from '../protocol.js';
import { replaySettlement,storedSettlement } from './rows.js';
/** A standalone transaction owns FK deferral until enforced COMMIT or completed ROLLBACK. */
export class BackendSettlements {
 constructor(private readonly db:DatabaseSync,private readonly runs:{get(key:RunKey):Run}){}
 read(input:OutputDeletionKey){
  const key=settlementKey(input);
  assertSettlementConnection(this.db);const stored=storedSettlement(this.db,key);
  return stored?{kind:'settled' as const,settlement:stored.result}:{kind:'missing' as const};
 }
 settle(input:BackendSettlementWrite){
  const write=captureSettlementWrite(input);
  const db=this.db;assertSettlementConnection(db);
  this.begin();
  try{
   const replay=replaySettlement(db,write);
   if(replay){db.exec('COMMIT');this.restored();return replay;}
   db.exec('PRAGMA defer_foreign_keys=ON');commitBackendSettlement(db,this.runs,write);
   const stored=storedSettlement(db,write.key);if(!stored)throw new StorageError('unavailable');
   db.exec('COMMIT');this.restored();return stored.result;
  }catch(error){
   assertSettlementConnection(db);
   if(db.isTransaction){try{db.exec('ROLLBACK');}catch{poisonSettlementConnection(db);}}
   this.restored();throw error;
  }
 }
 private begin():void{
  const db=this.db;
  if(db.isTransaction||db.prepare('PRAGMA foreign_keys').get()?.foreign_keys!==1
   ||db.prepare('PRAGMA defer_foreign_keys').get()?.defer_foreign_keys!==0)throw new StorageError('conflict');
  db.exec('BEGIN IMMEDIATE');
 }
 private restored():void{
  let restored=false;
  try{restored=!this.db.isTransaction&&this.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys===1
    &&this.db.prepare('PRAGMA defer_foreign_keys').get()?.defer_foreign_keys===0;}
  catch{poisonSettlementConnection(this.db);}
  if(!restored)poisonSettlementConnection(this.db);
 }
}

export { settlementOperation,captureSettlementOperation,captureSettlementValue } from './wire.js';

export { retiredHistoryJob } from './rows.js';
