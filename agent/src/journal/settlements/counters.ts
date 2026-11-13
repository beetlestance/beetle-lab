import type { DatabaseSync } from 'node:sqlite';
import { Failure } from '../sql.js';
export type HoldCounters=readonly[number,number,number,number,number];
export type ReplayCounters=readonly[number,number];
function amount(value:unknown):number{
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new Failure('unavailable');return value;
}
export function replayCounters(db:DatabaseSync):ReplayCounters{
 const row=db.prepare('SELECT original_count,charged_bytes FROM agent_replay_storage WHERE id=1').get();
 const count=amount(row?.original_count);const bytes=amount(row?.charged_bytes);
 if(count>Math.floor(Number.MAX_SAFE_INTEGER/4096)||bytes!==count*4096)throw new Failure('unavailable');return[count,bytes];
}
export function holdCounters(db:DatabaseSync):HoldCounters{
 const row=db.prepare(`SELECT held_count,held_output_bytes,held_staging_bytes,retained_output_bytes,retained_staging_bytes
  FROM disk_retention_stats WHERE id=1`).get();
 return[amount(row?.held_count),amount(row?.held_output_bytes),amount(row?.held_staging_bytes),
  amount(row?.retained_output_bytes),amount(row?.retained_staging_bytes)];
}
export function transferCounters(db:DatabaseSync,hold:{readonly outputBytes:number;readonly stagingBytes:number}){
 const replayBefore=replayCounters(db);const holdBefore=holdCounters(db);
 if(replayBefore[1]>Number.MAX_SAFE_INTEGER-4096)throw new Failure('quota_exceeded');
 const replayAfter:ReplayCounters=[replayBefore[0]+1,replayBefore[1]+4096];
 const holdAfter:HoldCounters=[holdBefore[0]-1,holdBefore[1]-hold.outputBytes,holdBefore[2]-hold.stagingBytes,
  holdBefore[3]-hold.outputBytes,holdBefore[4]-hold.stagingBytes];
 for(const value of holdAfter)amount(value);
 return{replayBefore,replayAfter,holdBefore,holdAfter};
}
