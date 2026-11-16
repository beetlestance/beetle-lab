import type { DatabaseSync } from 'node:sqlite';
import { admissionInput } from '../admission-input.js';
import { storedObservation } from '../admission-data.js';
import { holdCounters,replayCounters } from '../settlements/counters.js';
import { decideRejectedFunding } from '../../rejected-cleanup-policy/index.js';
import type { RejectedFundingSnapshot } from '../../rejected-cleanup-policy/index.js';
import { Failure } from '../sql.js';
function counter(value:unknown):number{
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new Failure('unavailable');return value;
}
export function rejectedCounters(db:DatabaseSync):readonly[number,number,number]{
 const row=db.prepare('SELECT original_count,charged_bytes,last_clock FROM rejected_cleanup_storage WHERE id=1').get();
 const count=counter(row?.original_count);const bytes=counter(row?.charged_bytes);const clock=counter(row?.last_clock);
 if(count>64||bytes!==count*16384)throw new Failure('unavailable');return[count,bytes,clock];
}
/** Scalar counter/configuration reads plus at most65 compact active resource records. */
export function requireRejectedCapacity(db:DatabaseSync,original:{usedBytes:number;quotaBytes:number}):number{
 const row=db.prepare(`SELECT CASE WHEN length(CAST(configuration_json AS BLOB))<=65536 THEN configuration_json END configuration,
  CASE WHEN length(CAST(observation_json AS BLOB))<=65536 THEN observation_json END observation,last_clock FROM admission_settings WHERE id=1`).get();
 if(typeof row?.configuration!=='string'||typeof row.last_clock!=='number')throw new Failure('unavailable');
 const configured=admissionInput({kind:'configure',configuration:JSON.parse(row.configuration) as unknown} as Parameters<typeof admissionInput>[0]);
 if(configured.kind!=='configure')throw new Failure('unavailable');
 const rows=db.prepare(`SELECT json_extract(reservation_json,'$.status') status,json_extract(reservation_json,'$.resources') resources
  FROM reservations WHERE charged=1 ORDER BY id LIMIT 65`).all();
 if(rows.length>64)throw new Failure('unavailable');
 const reservations=rows.map(value=>{
  if(value.status!=='charged'||typeof value.resources!=='string'||Buffer.byteLength(value.resources)>1024)throw new Failure('unavailable');
  return{status:'charged' as const,resources:JSON.parse(value.resources) as RejectedFundingSnapshot['reservations'][number]['resources']};
 });
 const [cleanupCount,cleanupBytes,fundingClock]=rejectedCounters(db);const clock=Date.now();const decision=decideRejectedFunding({configuration:configured.configuration,
  observation:storedObservation(row.observation),now:clock,lastClock:Math.max(row.last_clock,fundingClock),reservations,
  heldStagingBytes:holdCounters(db)[2],replayBytes:replayCounters(db)[1],cleanupCount,cleanupBytes},original);
 if(!decision.ok)throw new Failure(decision.reason==='capacity_unknown'?'recovery_required':'quota_exceeded');
 return clock;
}
