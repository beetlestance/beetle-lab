import type { DatabaseSync } from 'node:sqlite';
import { Failure } from '../sql.js';
import { purgeOrder } from './purge-order.js';
function boundedCount(value:unknown,limit:number):number{
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>limit)throw new Failure('conflict');return value;
}
/** Fixed bounded rows only; the two proof branches impose their distinct required/missing records. */
export function originalCounts(db:DatabaseSync,attemptId:string,spool:{readonly rows:number;readonly bytes:number}){
 const counts=new Map<typeof purgeOrder[number],number>();
 for(const table of purgeOrder){
  const limit=table==='event_spool'?65536:1;
  const value=db.prepare(`SELECT count(*) n FROM (SELECT 1 FROM ${table} WHERE attempt_id=? LIMIT ?)`).get(attemptId,limit+1)?.n;
  counts.set(table,boundedCount(value,limit));
 }
 const bytes=db.prepare('SELECT coalesce(sum(charged_bytes),0) n FROM (SELECT charged_bytes FROM event_spool WHERE attempt_id=? LIMIT 65537)').get(attemptId)?.n;
 if(counts.get('event_spool')!==spool.rows||bytes!==spool.bytes)throw new Failure('conflict');return counts;
}
